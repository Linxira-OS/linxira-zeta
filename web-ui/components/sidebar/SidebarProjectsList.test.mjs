import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listSource = await readFile(new URL("./SidebarProjectsList.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("../SessionSidebar.tsx", import.meta.url), "utf8");

test("project rows are wrapped in DndContext + a vertical SortableContext", () => {
	assert.match(listSource, /import \{[^}]*DndContext[^}]*\} from "@dnd-kit\/core"/s);
	assert.match(
		listSource,
		/<DndContext[\s\S]*?sensors=\{sensors\}[\s\S]*?collisionDetection=\{closestCenter\}[\s\S]*?onDragEnd=\{handleDragEnd\}/,
	);
	assert.match(listSource, /<SortableContext items=\{projectPaths\} strategy=\{verticalListSortingStrategy\}>/);
	assert.match(listSource, /useSortable\(\{/);
});

test("the drag handle is a dedicated control, never the clickable row button", () => {
	// Exactly one activator: the grip button inside the hover cluster.
	assert.equal((listSource.match(/\{\.\.\.listeners\}/g) ?? []).length, 1);
	const handleStart = listSource.indexOf("ref={setActivatorNodeRef}");
	assert.ok(handleStart > -1, "the handle must own setActivatorNodeRef");
	const handle = listSource.slice(handleStart, listSource.indexOf("</button>", handleStart));
	assert.match(handle, /aria-label=\{t\("sidebar\.projects\.reorderHandle"\)\}/);
	assert.match(handle, /touchAction: "none"/);

	// The row button that switches/collapses a project carries no drag wiring.
	const rowButton = listSource.slice(listSource.indexOf("onClick={() => {"), listSource.indexOf("title={group.project}"));
	assert.ok(rowButton.length > 0);
	assert.doesNotMatch(rowButton, /listeners|setActivatorNodeRef|\{\.\.\.attributes\}/);

	// The seeded default workspace is a fixed anchor: no drag source on its row.
	assert.match(listSource, /\{!group\.isDefault && \(/);
});

test("click vs drag: pointer activation needs movement; keyboard uses sortable coordinates", () => {
	assert.match(listSource, /useSensor\(PointerSensor, \{ activationConstraint: \{ distance: 5 \} \}\)/);
	assert.match(listSource, /useSensor\(KeyboardSensor, \{ coordinateGetter: sortableKeyboardCoordinates \}\)/);
	assert.match(listSource, /roleDescription: t\("sidebar\.projects\.reorderRole"\)/);
	assert.match(
		listSource,
		/screenReaderInstructions: \{ draggable: t\("sidebar\.projects\.dragInstructions"\) \}/,
	);
	assert.match(listSource, /onDragStart:/);
	assert.match(listSource, /onDragCancel:/);
});

test("a drop persists the manual order, flips the menu to manual, and refreshes prefs", () => {
	const callback = sidebarSource.slice(
		sidebarSource.indexOf("onReorderProjects={"),
		sidebarSource.indexOf("onDeleteProjectSessions="),
	);
	assert.ok(callback.length > 0);
	assert.match(callback, /reorderProjects\(orderedPaths\)/);
	assert.match(callback, /setProjSort\("manual"\)/);
	assert.match(callback, /setPrefsVersion\(v => v \+ 1\)/);
	// The default workspace still outranks the manual order on screen.
	assert.match(sidebarSource, /defaultWorkspaceFirst\(ordered, defaultWorkspace\)/);
});
