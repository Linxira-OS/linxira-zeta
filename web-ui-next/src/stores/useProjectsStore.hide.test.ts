import { describe, expect, test } from "bun:test"
import type { ProjectEntry } from "@/lib/api/types"
import { useProjectsStore } from "./useProjectsStore"

// Bundle the Phase 5 project-hide contract in one place: hide/unhide
// round-trip, persistence-independent store state, and removeProject
// cleaning the hidden set.
describe("useProjectsStore project hide", () => {
  test("hideProject marks and unhideProject restores", () => {
    const project = { id: "project-a", path: "/repo", label: "Repo" } as ProjectEntry
    useProjectsStore.setState({
      projects: [project],
      activeProjectId: project.id,
      hiddenProjectIds: [],
    })

    const store = useProjectsStore.getState()
    expect(store.isProjectHidden("project-a")).toBe(false)

    store.hideProject("project-a")
    expect(useProjectsStore.getState().isProjectHidden("project-a")).toBe(true)
    expect(useProjectsStore.getState().hiddenProjectIds).toEqual(["project-a"])

    store.unhideProject("project-a")
    expect(useProjectsStore.getState().isProjectHidden("project-a")).toBe(false)
    expect(useProjectsStore.getState().hiddenProjectIds).toEqual([])
  })

  test("removeProject drops the hidden entry too", () => {
    const project = { id: "project-b", path: "/repo-b", label: "Repo B" } as ProjectEntry
    useProjectsStore.setState({
      projects: [project],
      activeProjectId: project.id,
      hiddenProjectIds: ["project-b"],
    })

    useProjectsStore.getState().removeProject("project-b")

    expect(useProjectsStore.getState().projects).toEqual([])
    expect(useProjectsStore.getState().hiddenProjectIds).toEqual([])
  })

  test("hideProject is idempotent", () => {
    const project = { id: "project-c", path: "/repo-c", label: "Repo C" } as ProjectEntry
    useProjectsStore.setState({
      projects: [project],
      activeProjectId: project.id,
      hiddenProjectIds: [],
    })

    useProjectsStore.getState().hideProject("project-c")
    useProjectsStore.getState().hideProject("project-c")
    expect(useProjectsStore.getState().hiddenProjectIds).toEqual(["project-c"])
  })
})
