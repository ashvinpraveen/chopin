import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { expandToLinkedMembers, linkedGestureKeys, linkedMembersOf } from "./audioClipLink";
import { MAX_HAND_EDIT_CLIPS } from "./timelineEditing";
import { isLinkedSelectionOn } from "../../utils/linkedClipPreferences";

/**
 * Select `key` the way a clip click does, then widen to link partners; Alt
 * (or Linked Selection off) selects `key` alone, even inside a larger selection.
 */
export function selectClipWithLinks(
  key: string,
  altKey: boolean,
  setSelectedElementId: (id: string) => void,
): void {
  const state = usePlayerStore.getState();
  if (altKey || !isLinkedSelectionOn()) {
    state.setSelection([key], key);
    return;
  }
  setSelectedElementId(key);
  const { selectedElementIds, elements } = usePlayerStore.getState();
  const expanded = expandToLinkedMembers(selectedElementIds, elements);
  if (expanded.size > selectedElementIds.size) state.setSelection(expanded, key);
}

export function toggleClipWithLinks(key: string, altKey: boolean): TimelineElement | null {
  const state = usePlayerStore.getState();
  const element = state.elements.find((el) => (el.key ?? el.id) === key);
  const members = element
    ? linkedMembersOf(element, state.elements, !altKey && isLinkedSelectionOn())
    : [];
  const memberKeys = members.length > 0 ? members.map((el) => el.key ?? el.id) : [key];
  const next = new Set(state.selectedElementIds);
  const removing = next.has(key);
  for (const memberKey of memberKeys) {
    if (removing) next.delete(memberKey);
    else next.add(memberKey);
  }
  state.setSelection(next, removing ? state.selectedElementId : key);
  const primary = usePlayerStore.getState().selectedElementId;
  return state.elements.find((el) => (el.key ?? el.id) === primary) ?? null;
}

/** Whether grabbing `grabbed` would move or resize more clips by hand than a hand drag allows. */
export function exceedsHandEditLimit(grabbed: TimelineElement, altKey: boolean): boolean {
  const { selectedElementIds, elements } = usePlayerStore.getState();
  const moved = linkedGestureKeys(
    selectedElementIds,
    grabbed,
    elements,
    altKey,
    isLinkedSelectionOn(),
  );
  return moved.size > MAX_HAND_EDIT_CLIPS;
}
