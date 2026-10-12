# IFC2IndoorGML (Web)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OGC IndoorGML 2.0](https://img.shields.io/badge/OGC-IndoorGML%202.0-green.svg)](https://www.ogc.org/standard/indoorgml/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r183-black.svg)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF.svg)](https://vitejs.dev/)

> **A 100% client-side, browser-based converter and visualizer transforming Industry Foundation Classes (IFC) BIM models into OGC IndoorGML 2.0 XML with the Multi-Layer Space Model (MLSM).**

Zero installations, zero server uploads, zero backend data leakage—all IFC geometry parsing, spatial hierarchy extraction, dual network generation, and IndoorGML 2.0 serialization happen entirely inside your web browser.

---

## 🌟 Key Features

### 1. 100% Client-Side BIM Processing
- Powered by [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) and [`@thatopen/components`](https://github.com/ThatOpen/engine_components).
- Parses `.ifc` files directly in WebAssembly (WASM). Your proprietary BIM models never leave your machine.
- Interactive 3D visualization via Three.js with orbit controls, camera framing, raycasting selection, and instant element visibility toggling.

### 2. Spatial Hierarchy & Containment (`IfcRelContainedInSpatialStructure`)
- Automatically reconstructs the full IFC spatial tree:
  $$\text{Project} \longrightarrow \text{Site} \longrightarrow \text{Building} \longrightarrow \text{Storeys} \longrightarrow \text{Spaces / Openings / Elements}$$
- **Fine-Grained Classification**: Distinguishes true **Furniture** (`IFCFURNITURE`, `IFCFURNISHINGELEMENT`), **Equipment/MEP** (`IFCFLOWTERMINAL`, `IFCSANITARYTERMINAL`, fixtures), **Structure** (walls, slabs, columns), **Openings** (doors, windows), and **Spaces** (`IFCSPACE`).
- **Space Containment Detection**: Identifies objects contained inside specific rooms via both `IfcRelContainedInSpatialStructure` relationships and 3D geometric containment fallbacks, badging items directly in the tree (e.g., `📍 In: Office 101`).

### 3. Simultaneous Multi-Select Category Presets
- Quick-filter preset pills that can be combined simultaneously:
  - `🛋️ Spaces`
  - `🪑 Furniture`
  - `📦 In Spaces` *(all items contained inside rooms)*
  - `🔌 Equipment`
  - `🚪 Openings`
  - `🧱 Structure`
  - `[All]` / `[Clear]`
- Instantly isolates or combines categories in both the hierarchy tree and the 3D viewport.

### 4. OGC IndoorGML 2.0 Multi-Layer Space Model (MLSM)
Decoupled into two dedicated, standards-compliant processes:
- **Process 1: Thematic Layers Manager**:
  - Independent from physical building storeys/floors.
  - Create custom thematic layers (e.g., *Spaces Layer*, *Furniture Layer*, *Sensor Coverage Layer*) by selecting any combination of geometries from the hierarchy or presets.
  - Configurable themes: `Physical`, `Virtual`, `Tags`, `Unknown`.
- **Process 2: InterLayerConnection Builder (SVO Topology)**:
  - Connects distinct thematic layers using **Subject-Verb-Object (SVO)** topological grammar:
    $$\text{Subject (Layer 1)} \xrightarrow{\text{Verb}} \text{Object (Layer 2)}$$
  - Topological expressions: `Contains`, `Within`, `Overlaps`, `Equals`, `Crosses`, `Other`.
  - Configurable at **Whole-Layer scope** or **Granular Cell & Node scope** (e.g., *Space 101* `Contains` *Desk 42*).
  - Automatically gated: InterLayerConnection requires $\ge 2$ layers (per schema `minOccurs="2" maxOccurs="2"`).
- **Default Single-Layer Fallback**:
  - If no custom layers are created, the exporter automatically outputs a clean single layer (*Default Physical Layer*, Theme: `Physical`) containing only `IfcSpace` + `IfcOpening` cell spaces and the dual navigation network.

### 5. 3D Primal Geometry & Solid Serialization
- Serializes true 3D boundary geometry `<gml:Solid>` using `<gml:Shell>` / `<gml:surfaceMember>` / `<gml:Polygon>` rather than bounding boxes or conceptual points.
- Automatically handles planar normal orientations and GML coordinate string formatting.

### 6. Dual Topological Network
- Dual nodes computed at 3D space centroids and opening transitions.
- Dual edges extracted from `IfcRelSpaceBoundary` topological relations.
- **Bounding-Box Intersection Fallback**: Optional geometric intersection engine to recover topological connections in imperfect or unlinked IFC models.

---

## 📐 IndoorGML 2.0 Schema Conformance

The exported XML strictly complies with official OGC IndoorGML 2.0 XML schemas:
- **`IndoorGML_core.xsd`**:
  - `<core:IndoorFeatures>` document root
  - `<core:ThematicLayer>` with `<core:theme>`, `<core:primalSpaceFeatures>`, `<core:dualSpaceFeatures>`
  - `<core:InterLayerConnection>` with `<core:connectedLayers>`, `<core:typeOfTopoExpression>`, `<core:connectedCells>`, `<core:connectedNodes>`
  - `<core:CellSpace>` primal geometry with `<core:geometry3D>` $\rightarrow$ `<gml:Solid>`
  - `<core:Nodes>` and `<core:Edges>` dual topology
- **`IndoorGML_navi.xsd`**:
  - `<navi:TransferSpace>` for openings (doors/windows)
  - `<navi:NavigableSpace>` / `<navi:GeneralSpace>` for navigable zones

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- `npm` (version 9 or higher)

### Installation
```bash
# Clone the repository
git clone https://github.com/your-username/ifc2indoorgml_web.git

# Enter project directory
cd ifc2indoorgml_web

# Install dependencies
npm install
```

### Running Locally
```bash
# Start Vite development server
npm run dev
```
Open your browser at **`http://localhost:5173/`**.

### Building for Production
```bash
# Compile TypeScript & bundle production assets
npm run build

# Preview production build locally
npm run preview
```

---

## 📖 Step-by-Step Walkthrough

1. **Upload an IFC Model**:
   - Click **📁 Upload IFC** and pick any `.ifc` file (a sample [`fzk-haus.ifc`](./fzk-haus.ifc) is included in the root directory for quick testing).
2. **Inspect the Hierarchy & 3D View**:
   - Browse the **Hierarchy** tab to view Storeys, Spaces, Openings, and Elements.
   - Click any item to focus the 3D camera on it and view its express ID and containment details in the inspector.
3. **Filter with Multi-Select Presets**:
   - In the **Layers** tab, toggle presets like `🛋️ Spaces` and `🪑 Furniture` simultaneously.
4. **Create Thematic Layers (Process 1)**:
   - With elements checked in the hierarchy, give your layer a name (e.g. *Spaces Layer*) and Theme (`Physical`), then click **➕ Create Layer**.
   - Create a second layer (e.g. *Furniture Layer*).
5. **Connect Layers with SVO (Process 2)**:
   - Once $\ge 2$ layers exist, the **InterLayerConnection** builder becomes active.
   - Select **Subject Layer**, **Topological Verb** (e.g., `Contains`), and **Object Layer**.
   - Optionally pick specific spaces/cells or whole layers, and click **Add SVO Connection**.
6. **Generate & Export**:
   - Click **⚡ Generate** to preview the dual graph in 3D (space nodes as cyan spheres, openings as orange spheres, edges as cyan lines, inter-layer connections as dashed magenta links).
   - Click **💾 Export GML** to download the valid IndoorGML 2.0 XML file.

---

## 📁 Repository Structure

```
ifc2indoorgml_web/
├── index.html                   # Main application layout and responsive UI
├── package.json                 # Project dependencies and npm scripts
├── tsconfig.json                # TypeScript compiler configuration
├── vite.config.ts               # Vite bundler configuration
├── IndoorGML_core.xsd           # OGC IndoorGML 2.0 Core XML Schema
├── IndoorGML_navi.xsd           # OGC IndoorGML 2.0 Navigation XML Schema
├── fzk-haus.ifc                 # Sample IFC model (Karlsruhe Institute of Technology)
├── public/                      # Static assets and WebAssembly binaries
└── src/
    ├── main.ts                  # Application controller, UI state & event binding
    ├── style.css                # Modern dark-mode styling & responsive design
    ├── ifc/
    │   └── IfcExtractionService.ts   # IFC parsing, hierarchy extraction & containment
    ├── indoorgml/
    │   └── IndoorGmlExportService.ts # IndoorGML 2.0 XML generator & serializer
    ├── network/
    │   └── IndoorNetworkService.ts   # Dual graph data structures (Node & Edge)
    └── viewer/
        └── ThreeViewer.ts            # Three.js 3D viewport & ThatOpen integration
```

---

## 🛠️ Technology Stack

| Component | Library / Standard |
|---|---|
| **BIM Engine** | [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) + [`@thatopen/components`](https://github.com/ThatOpen/engine_components) |
| **3D Rendering** | [Three.js](https://threejs.org/) |
| **Logic & Types** | [TypeScript](https://www.typescriptlang.org/) |
| **Build & Dev Server** | [Vite](https://vitejs.dev/) |
| **Indoor Standard** | [OGC IndoorGML 2.0 (Core & Navi)](https://www.ogc.org/standard/indoorgml/) |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.

---

## 🤝 Acknowledgements

- **OGC IndoorGML Standards Working Group (SWG)** for the IndoorGML 2.0 standard specifications.
- **ThatOpen Company** (formerly IFC.js) for the high-performance WebAssembly IFC parsing engine.
- **Karlsruhe Institute of Technology (KIT)** for the open-source `FZK-Haus` IFC benchmark model.
