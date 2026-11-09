// The tooltips QUICKSURFACE 8.0.128 shows on its ribbon buttons, read from the running program's
// accessibility tree (analysis/quicksurface-ui-2026-11-09/native-ribbon.json). A person hovering a
// button should read what native says. Where a button is unavailable, Quick Scan adds its own reason on
// a second line, because it is useful and native's is silent.
//
// Four names mean different things in different tabs (Export, Thicken, Offset, Draft): those are keyed
// 'Tab:Label', and the ribbon passes the tab-qualified key.
export const NATIVE_TIPS: Record<string, string> = {
  Save: 'Save the project on disk or network location',
  'Save As ...': 'Saves the project under different name',
  "2D Sketch": "Define plane for sketching and get section points from the underlying mesh",
  "About ...": "A general information about the software",
  "Activate Software": "Activates the software by providing a license key",
  "Align Interactive": "Manually reposition the scan data with on-screen controls",
  "Auto Freeform": "Creates surface fully automatically from the reference mesh",
  "Average Mesh": "Creates an average mesh from two or more overlapping meshes of parts of the same shape (also known as Golden Mesh)",
  "Change log": "Opens the website with the changes of the software",
  "Check for update": "Connects to internet to check for the latest version and provides notification if there is a new version",
  "Combine": "Combines two or more overlapping solids into a single solid",
  "Compare": "Evaluates the deviation of the reference mesh to the visible surfaces",
  "Compare to other meshes": "Compare the selected scan to the other visible scan meshes",
  "Convert to CAD body": "Converts a Freeform surface into CAD solid or surface",
  "Credits ...": "Show licenses and contributions of the team for creating QUICKSURFACE",
  "Cut": "Removes material from the base solid using another solid",
  "Cylinder from CAD": "Create a cylinder from a cylindrical CAD face",
  "Deselect All": "Deselect all selected triangles",
  "Duplicate Face": "Creates a new single surface from the preselected CAD face",
  "Edit": "Edit the reference mesh or point cloud to delete unwanted areas, fill holes or remove outliers",
  "Edit Scan": "Edit the reference mesh or point cloud to delete unwanted areas, fill holes or remove outliers",
  "Environment Map": "Displays surfaces with fully reflectional surfaces",
  "Extract primitives": "Create primitives from selected areas of the reference mesh with best fitting",
  "Extrude": "Creates an extruded surface from the selected sketch only if the sketch has been created for extruded surface",
  "Fillet / Chamfer": "Rounds selected edges with specified radius",
  "Fit Surface": "Approximates selected triangles and generates a single surface with best fitting",
  "Flip Normals": "Flips the orientation of the mesh",
  "From 2D sketch": "Creates a surface from 2D sketch if there are closed contours",
  "From 3D Sketch": "Create Freeform from 3D sketch",
  "From quad OBJ ...": "Loads Freeform surface from the disk",
  "Global Fine Align": "Fine align two or more overlapping scan data by minimising the overlapping distance",
  "Inches": "All dimensions will be shown in inches",
  "Intersect": "Creates the common solid of two or more overlapping solids",
  "Metres": "All dimensions will be shown in metres",
  "Middle plane": "Create a plane which is a middle plane of two planes",
  "Millimetres": "All dimensions will be shown in millimetres",
  "Mirror": "Mirrors the selected scan data using a plane",
  "Move body": "Move the selected surface or solid body in space",
  "Move face": "Interactively move a face from a CAD body",
  "Multiple sections": "Create multiple slices on the scan data using starting plane, axis or guide curve",
  "New Freeform": "Create new Freeform surface",
  "Open": "Open existing project or scan data like STL or OBJ files",
  "Options": "Set custom colors, mouse navigation options and more",
  "Plane": "Create a plane aligned to standard axis or from other planes",
  "Plane along path": "Create a plane passing through a point from a curve and perpendicular to this curve",
  "Plane from 2D sketch": "Creates a plane from a 2D sketch where it has been defined",
  "Plane from CAD": "Create a plane primitive from a planar CAD face",
  "Plane through sketch line": "Creates a plane passing through a sketch line at a specified user angle",
  "Prepare Scan": "Runs a step-by-step wizard to setup the data for reverse engineering",
  "Project sketch": "Projects the preselected sketch on a surface or solid body.",
  "Re-polygonize": "Creates single mesh from multiple overlapping meshes",
  "Reduce noise": "Reduce noise on the mesh",
  "Reduce polygons": "Create a new mesh with less number of triangles",
  "Reference Line": "Create a line from two points",
  "Reference Point": "Create point",
  "Reset layout...": "Reset the polistions of the panels to their original states",
  "Revolve": "Creates a revolved surface from the selected sketch only if the sketch has been created for revolved surface",
  "Roll Sketch": "Creates 3D sketch from 2D sketch by rolling back",
  "Scale body": "Scales selected body uniformly or non-uniformly",
  "Separate bodies": "Creates new features with one body only from a feature which has more than one body or splits a single body into forming faces",
  "Shell": "Removes selected faces from a solid and offsets the remaining faces to create a thickened solid body",
  "Show Hidden": "Shows all hidden triangles if any",
  "Snapshot": "Captures current image to the windows clipboard",
  "Split solid": "Splits a solid with a surface. Preselect a solid entity and a single surface entity. The software will generate 2 entities - one for the front and another for the back side of the surface.",
  "Symmetry Plane": "Create a plane which is a symmetry plane of an object",
  "System Log ...": "Shows some system information for diagnostics",
  "Trim": "Trims selected surfaces",
  "Try Lite": "Switch between Lite or Pro version to explore the difference in the features",
  "Unroll": "Unrolls the mesh based on a cylinder and reference angle",
  "Video Tutorials": "Watch video step-by-step on our website",
  "Wrap Surface": "Wraps cylindrical surface to the selected triangles of the reference mesh",
  "Zebra Stripes": "Displays surfaces with stripes to analyse the curvature and smoothness",
  'Export Model': 'Export created model for another application',
  'Export Visible': 'Exports all the visible scan data for another applications',
  'Freeform:Thicken': 'Creates solid body from a Freeform surface by offsetting the surface',
  'Surfacing:Thicken': 'Thickens the selected surface body',
  'Freeform:Offset': 'Offsets selected free form and creates a copy of the original',
  'Surfacing:Offset': 'Offsets selected surface',
  'CAD:Draft': 'Taper faces on a body',
  'Analysis:Draft': 'Analysis of the draft angle for manufacturing',
}

/** What an unavailable button's own hint says when it is a reason ("Create a sketch first.", "... not built in Quick Scan yet"). */
const REASON =/first|not built|not implemented|not available|needs? a/i

/** The tooltip text for a ribbon button: native's description when it has one; Quick Scan's own hint
 *  when it does not. An unavailable button keeps its reason after native's description. */
export function nativeTip(key: string, own: string, disabled = false): string {
  const native = NATIVE_TIPS[key]
  if (!native) return own
  if (!disabled || !REASON.test(own)) return native
  return native + '\n' + own
}
