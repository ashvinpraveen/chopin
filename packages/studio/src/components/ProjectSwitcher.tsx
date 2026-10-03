import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { buildProjectHash } from "../utils/projectRouting";
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem } from "./ui";

interface ProjectSummary {
  id: string;
  title?: string;
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return (
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
  );
}

export function parseProjectList(body: unknown): ProjectSummary[] {
  if (typeof body !== "object" || body === null || !("projects" in body)) return [];
  return Array.isArray(body.projects) ? body.projects.filter(isProjectSummary) : [];
}

/**
 * The project name in the header, as a menu of every project Studio can serve.
 * Picking one only changes the hash; `useServerConnection` validates and adopts it.
 */
export function ProjectSwitcher({ projectId }: { projectId: string | null }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  // Fetched on every open, not once: a project linked into data/projects while
  // Studio is running should show up without a reload.
  const refresh = () => {
    fetch("/api/projects")
      .then((response) => response.json())
      .then((body: unknown) => setProjects(parseProjectList(body)))
      .catch(() => setProjects([]));
  };

  return (
    <Menu
      aria-label="Projects"
      align="center"
      onOpenChange={(open) => {
        if (open) refresh();
      }}
      trigger={
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-2 h-6 text-step-12 font-medium text-text-2 hover:text-text-1 hover:bg-hover outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
        >
          {projectId}
          <CaretDown size={10} weight="bold" className="text-text-4" aria-hidden="true" />
        </button>
      }
    >
      {projects === null ? (
        <MenuItem disabled>Loading…</MenuItem>
      ) : projects.length === 0 ? (
        <MenuItem disabled>No projects found</MenuItem>
      ) : (
        <MenuRadioGroup
          value={projectId ?? ""}
          onValueChange={(id: unknown) => {
            if (typeof id === "string" && id !== projectId)
              window.location.hash = buildProjectHash(id);
          }}
        >
          {projects.map((project) => (
            <MenuRadioItem key={project.id} value={project.id}>
              {project.title ?? project.id}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      )}
    </Menu>
  );
}
