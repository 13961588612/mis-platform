# Visual Workflow Designer - 可视化流程编排器设计

> **Version**: v1.0 | **Date**: 2026-10-06 | **Status**: Design Draft  
> **Target**: Drag-and-drop BPMN-style workflow editor built on @xyflow/react@^12 + shadcn-ui

---

## 1. Existing Infrastructure Confirmed

### Installed Dependencies (ALL YES)

| Package | Version | Purpose |
|---------|---------|---------|
| @xyflow/react | ^12.3.0 | React Flow canvas engine (already installed) |
| @dagrejs/dagre | ^1.1.4 | Auto-layout algorithm (already installed) |
| zustand | ^4.5.2 | State management (already installed) |
| @radix-ui/* | various | Dialog/Select/Tabs/Collapsible... (all present) |

### Mature Reference Implementation Exists

The project already has a fully working ER-model canvas at eatures/agent/iqd/components/modeling/:

| File | Feature | Reusability |
|------|---------|-------------|
| ModelCanvas.tsx | ReactFlow container + Controls + MiniMap + Background | ~80% reuse |
| ModelNodeCard.tsx | Custom node cards with Handles + Badges | Structure reused directly |
| RelationEdge.tsx | BaseEdge custom edges with interactionWidth hit layer | Architecture reused directly |
| useCatalogNodes.ts | Derived node data strategy | Pattern reused directly |

**Conclusion: No new dependencies needed.** Everything can be extended from existing code.

---

## 2. Overall Layout

Three-panel layout similar to the IQD model canvas:

`	ext
+==========================================================================+
| Purchase Approval Flow (v2)                    [Validate] [Save Draft] [Publish]
+----------+---------------------------------------+------------------------+
|          |                                       |                        |
| Palette   |              Canvas                    |  Property Panel        |
| (220px)   |           (flex-1, adaptive)           |  (300px collapsible)   |
|          |                                       |                        |
| [+Start ] |    [Submit Request]                     | Selected: Dept Manager |
| [+Apprve ]|            | Approver                   | ---------------------- |
| [+Condtn ]|            v                            | Name: [            ] |
| [+Route ] |    [Amount Check]      [Yes]-[ GM App.]| Approver: [SuperVisor]|
| [+Auto .] |            |     [No]                   | Timeout: 24h x Notify|
| [+End   ] |            v                           | Allow Reject xAllow Fwd|
|          |    [Finance Review]                       | [Advanced Config v]   |
| [Search..]|            |                             |                        |
|          |            v                             | [Preview Diagram v]    |
|          |    [Archive] <============================ |                        |
|          |                                           |                        |
+----------+-------------------------------------------+------------------------+
| Zoom: [- o 100% +]  Fit All  Grid ON  Dagre Layout                               |
+--------------------------------------------------------------------------+
`

### Dimensions

| Area | Width | Notes |
|------|-------|-------|
| Palette | 220px (collapsible to 64px icon rail) | Drag nodes onto canvas |
| Canvas | flex-1 (auto) | Core editing area |
| Property Panel | 300px (collapsible) | Config for selected node |
| Toolbar | ~40px bottom bar | Zoom / Layout / Grid |

---

## 3. Node Types & Styling

Each node is a **shadcn Card** with ReactFlow Handle anchors and domain-specific content.

### 3.1 Start Node (WfStartNode)

Visual: green theme (primary), circular Play icon, indicates flow start

`	sx
// One Handle (source only, right side)
<div className='rounded border border-primary bg-primary/5 p-2'>
  <Handle type='source' position={Position.Right} />
  <div className='flex items-center gap-2'>
    <PlayIcon size={14} /> {/* inside primary circle */}
    <span>Submit Request</span>
  </div>
  <p className='text-[11px] text-muted-foreground truncate'>Description...</p>
</div>
`

### 3.2 Approval Node (WfApprovalNode)

Visual: blue theme, shows approver info summary and action toggles

`	sx
// Two Handles (target-left, source-right)
<div className='rounded border border-blue-400 bg-blue-50 p-2.5'>
  <Handle type='target' position={Position.Left} />
  <Handle type='source' position={Position.Right} />
  <CheckIcon /> Dept Manager Approval
  Badge: 'By SuperVisor · Timeout 24h'
  small text: OK Allow Reject  OK Allow Forward
</div>
`

### 3.3 Condition Branch Node (WfConditionNode)

Visual: amber theme, ONE input Handle (top) + MULTIPLE output Handles (right side)

`	sx
<div className='rounded border border-amber-400 bg-amber-50 p-2.5'>
  <Handle type='target' position={Position.Top} />
  <Handle type='source' id='yes' position={Position.Right} style={{top:'30%'}} />
  <Handle type='source' id='no'  position={Position.Right} style={{top:'70%'}} />
  GitBranchIcon + Amount Check
  code block: amount > 50000
  Badge: OK Yes ->  NO No ->
</div>
`

### 3.4 Route/Collaboration Node (WfRouteNode)

Visual: purple theme, shows parallel/serial info and participant list

`	sx
// Two Handles (left/right)
<div className='rounded border border-purple-400 bg-purple-50 p-2.5'>
  UsersIcon + Parallel Review
  Badge: 'Collab mode: ALL must pass'
  {participants.map(p => <Badge>{p}</Badge>)}
</div>
`

### 3.5 Automation Action Node (WfAutomationNode)

Visual: gray theme, shows API call or script info

`	sx
// Two Handles (left/right)
<div className='rounded border border-gray-400 bg-gray-50 p-2.5'>
  SettingsIcon + Generate Purchase Order
  span: 'API call -> POST /api/v1/purchase/orders'
</div>
`

### 3.6 End Node (WfEndNode)

Visual: red theme, indicates flow end

`	sx
// One Handle (target only, left side)
<div className='rounded border border-red-400 bg-red-50 p-2.5'>
  <Handle type='target' position={Position.Left} />
  FlagIcon + Archive Notification
  span: 'Notify initiator of result'
</div>
`

---

## 4. Edges (Lines) Design

### 4.1 Visual Encoding

| Type | Line Style | Arrow | Meaning |
|------|------------|-------|---------|
| Default flow | Solid smooth arc | Single arrow at target | Normal A->B |
| Condition YES | Green dashed line | Arrow | Path when condition met |
| Condition NO | Red dashed line | Arrow | Path when condition not met |
| Reject/return | Orange curved dashed | Arrow pointing back | Return to previous step |

### 4.2 Key Interactions

- **Double-click edge**: Opens edit dialog to modify label / condition expression
- **Hover edge**: Tooltip shows condition expression
- **Hit layer**: interactionWidth=16 so thin lines are clickable (same as RelationEdge pattern)

---

## 5. Property Panel (Right Side)

Dynamic form rendering based on which node is selected:

### Approval Node Config
- Node name (input field)
- Approver assignment method (dropdown: Fixed Person / Role / Supervisor / Dept Leader / Formula / User-selected)
- Allow reject toggle  Allow forward-toggle
- Timeout hours + timeout-handling behavior
- Advanced: Show form preview / Multi-person collab

### Condition Branch Config
- Condition expression (code editor with syntax ${field > value})
- Available variable list (extracted from linked form fields)
- Target node config for each output branch
- Add new branch button

### Global Flow Properties (when no node selected)
- Flow code, name, category
- Linked form selection
- Flow description
- Version management (create new version by copying current definition)

---

## 6. Left Palette (Drag & Drop)

### Drag mechanism using HTML DragDrop + ReactFlow

Palette item:
`	sx
<div draggable
     onDragStart={(e) => e.dataTransfer.setData('wf-node', 'APPROVAL')}
     className='cursor-move border-dashed hover:border-primary ...'>
  Approve Node
</div>
`

Canvas drop handler:
`	s
onDrop={(event) => {
  const nodeType = event.dataTransfer.getData('wf-node');
  const pos = reactFlow.screenToFlowPosition({ x, y });
  const node = {
    id: 
ode_,
    type: getNodeType(nodeType),
    position: pos,
    data: getDefaultNodeData(nodeType), // default name/approver/etc.
  };
  setNodes(prev => [...prev, node]);
}}
`

### Search filter
Fuzzy search by Chinese name or English code to show/hide palette items.

---

## 7. Bottom Toolbar

| Button | Function | Shortcut |
|--------|----------|----------|
| Zoom +/- | Canvas zoom in/out | Ctrl + / - |
| Fit All | Fit all nodes to view | Ctrl+Shift+F |
| Grid | Toggle grid background | G |
| Dagre Layout | Auto hierarchical layout (top-to-bottom) | Ctrl+L |
| Validate | Run completeness check | Ctrl+V |
| Undo/Redo | Step backward/forward | Ctrl+Z / Ctrl+Shift+Z |
| Copy/Paste | Duplicate a node | Ctrl+C/V |

### Dagre Auto-Layout

Uses existing @dagrejs/dagre:

`	s
const g = new dagre.graphlib.Graph();
g.setGraph({ rankdir: TB, ranksep: 120, nodesep: 60 });
nodes.forEach(n => g.setNode(n.id, { w: n.w || 200, h: n.h || 80 }));
edges.forEach(e => g.setEdge(e.source, e.target));
dagre.layout(g);
// Apply positions: nodes.map(n => ({...n, position: g.node(n.id)}))
`

---

## 8. Validation Rules (Pre-Publish Checklist)

Mandatory checks before publish:

| # | Rule | Severity |
|---|------|----------|
| 1 | Exactly one START node exists | Error (blocks publish) |
| 2 | Exactly one END node exists | Error (blocks publish) |
| 3 | All nodes reachable from START | Error (blocks publish) |
| 4 | Every condition branch output connects to something | Error (blocks publish) |
| 5 | Each approval node has an assignee configured | Error (blocks publish) |
| 6 | No cycles (excluding conditional return paths) | Warning (allow override) |
| 7 | No isolated nodes (unconnected) | Warning (allow override) |

Validation result shown in popup panel listing Errors (block) vs Warnings (overrideable).

---

## 9. Directory Structure

`
src/features/system/workflow-designer/
├── DesignerPage.tsx             # Three-panel main page
├── components/
│   ├── CanvasShell.tsx          # ReactFlow container wrapper
│   ├── Palette.tsx              # Left drag-and-drop node palette
│   ├── PropertyPanel.tsx        # Right dynamic property editor
│   ├── Toolbar.tsx              # Bottom toolbar
│   ├── nodes/                   # Six custom node types
│   │   ├── WfStartNode.tsx
│   │   ├── WfApprovalNode.tsx
│   │   ├── WfConditionNode.tsx
│   │   ├── WfRouteNode.tsx
│   │   ├── WfAutomationNode.tsx
│   │   └── WfEndNode.tsx
│   ├── edges/                   # Custom edge types
│   │   ├── WfFlowEdge.tsx       # Default solid flow edge
│   │   ├── WfConditionalEdge.tsx # Dashed yes/no edges (green/red)
│   │   └── WfRejectEdge.tsx     # Curved orange return-edge
│   ├── dialogs/
│   │   ├── AssigneePicker.tsx   # Approver selector dialog
│   │   └── VariableSelector.tsx # Form-field variable picker
│   ├── hooks/
│   │   ├── useWfLayout.ts       # Load/save layout to backend
│   │   └── useWfUndoRedo.ts     # Undo/redo history
│   └── utils/
│       ├── dagreLayout.ts       # Dagre wrapper
│       └── validator.ts         # Pre-publish validation
├── stores/
│   └── wf-designer-store.ts     # Zustand state store
└── types/
    └── workflow.ts              # TypeScript type definitions
`

---

## 10. Implementation Plan

| Phase | Content | Days |
|-------|---------|------|
| P1 | Canvas scaffold (store + 3-panel layout + reuse ModelCanvas patterns) | 2 |
| P2 | 6 node card components (palette drag & drop) | 3 |
| P3 | Edges + Dagre auto-layout + Validator | 2 |
| P4 | Property panel + Undo/Redo + Backend API integration | 2 |
| **Total** | | **~9 days** |

---

## 11. Acceptance Criteria

| # | Criterion | Description |
|---|-----------|-------------|
| 1 | Drag-to-create nodes | Drag from left palette onto canvas creates a node |
| 2 | Free node dragging | Nodes reposition on release, immediately reflected |
| 3 | Connect via Handles | Drag from Handle anchor to target node creates connection |
| 4 | Delete selection | Press Delete after selecting node or edge |
| 5 | Inline property editing | Click node, right panel edits config live |
| 6 | Multi-branch conditions | Configure Yes/No + add more outputs |
| 7 | Undo/Redo | Ctrl+Z / Ctrl+Shift+Z works through entire history |
| 8 | Dagre auto-layout | One click arranges all nodes hierarchically |
| 9 | Validation gate | Publish blocked if validation errors remain |
| 10 | Save & Publish | Draft and Published states; both persist correctly |
