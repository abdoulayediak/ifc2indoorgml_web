import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import { IFCSPACE, IFCOPENINGELEMENT, IFCDOOR, IFCWINDOW } from 'web-ifc';

import fragmentWorker from "./worker.mjs?url";

export class ViewerService {
    components: OBC.Components;
    world: OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>;
    fragments: OBC.FragmentsManager;
    ifcLoader: OBC.IfcLoader;
    networkGroup: THREE.Group;

    constructor(containerId: string) {
        const container = document.getElementById(containerId)!;
        this.components = new OBC.Components();
        const worlds = this.components.get(OBC.Worlds);
        this.world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();
        this.world.scene = new OBC.SimpleScene(this.components);
        this.world.renderer = new OBC.SimpleRenderer(this.components, container);
        this.world.camera = new OBC.SimpleCamera(this.components);

        this.components.init();

        this.world.scene.setup();
        this.world.scene.three.background = new THREE.Color('#1e1e1e');

        this.fragments = this.components.get(OBC.FragmentsManager);
        this.ifcLoader = this.components.get(OBC.IfcLoader);

        this.networkGroup = new THREE.Group();
        this.world.scene.three.add(this.networkGroup);
    }

    async init() {
        this.fragments.init(fragmentWorker);

        this.world.camera.controls.addEventListener("rest", () =>
            this.fragments.core.update(true)
        );

        this.fragments.list.onItemSet.add(async ({ value: model }) => {
            model.useCamera(this.world.camera.three);
            this.world.scene.three.add(model.object);
            await this.fragments.core.update(true);

            this.resetFocus();
        });

        // let webifc: any;
        // this.ifcLoader.onIfcImporterInitialized.add((importer) => {
        //     webifc = this.ifcLoader.webIfc;
        // });

        await this.ifcLoader.setup({
            autoSetWasm: false,
            wasm: {
                path: import.meta.env.BASE_URL,
                absolute: false
            }
        });
    }

    resetFocus() {
        const [model] = this.fragments.list.values();
        if (model && model.object) {
            const box = new THREE.Box3().setFromObject(model.object);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const camera = this.world.camera.three;

            // Only auto-focus if camera is Perspective
            if ((camera as any).isPerspectiveCamera) {
                const distance = maxDim / (2 * Math.tan((camera as THREE.PerspectiveCamera).fov * (Math.PI / 180) / 2));
                const pos = new THREE.Vector3(center.x + distance, center.y + distance, center.z + distance);
                this.world.camera.controls.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, true);
            }
        }
    }

    async loadIfc(file: File) {
        const data = await file.arrayBuffer();
        const fileBuffer = new Uint8Array(data);

        await this.ifcLoader.readIfcFile(fileBuffer);
        const model = await this.ifcLoader.load(fileBuffer, true, "IFC Model", {
            instanceCallback: (importer: any) => {
                console.log("IfcImporter instance callback called");
                importer?.classes?.elements?.add(IFCSPACE);
                importer?.classes?.elements?.add(IFCOPENINGELEMENT);
                importer?.classes?.elements?.add(IFCDOOR);
                importer?.classes?.elements?.add(IFCWINDOW);
            }
        });

        // Small delay to ensure fragments are fully registered in the manager
        await new Promise(resolve => setTimeout(resolve, 500));

        // Classify the model by category (entity type) to allow visibility toggling
        const classifier = this.components.get(OBC.Classifier);
        console.log("Starting classification...");
        await classifier.byCategory();
        console.log("Classification finished.");

        // After classification, apply initial visibility:
        // hide everything, then show only spaces and openings
        await this.setInitialVisibility();

        return model;
    }

    // The classification key registered by byCategory() is "Categories" (capital C)
    private readonly CLASSIFICATION = "Categories";
    private readonly SPACE_CATS = ["IFCSPACE"];

    async setInitialVisibility() {
        try {
            const hider = this.components.get(OBC.Hider);
            const classifier = this.components.get(OBC.Classifier);

            // 1. Hide everything
            await hider.set(false);

            // 2. Show only spaces
            const spaces = await classifier.find({ [this.CLASSIFICATION]: this.SPACE_CATS });
            await hider.set(true, spaces);

            // 3. Show all IfcOpeningElements
            const openings = await classifier.find({ [this.CLASSIFICATION]: ["IFCOPENINGELEMENT"] });
            await hider.set(true, openings);

            // 4. Color all IfcOpeningElements transparent yellow
            const [model] = this.fragments.list.values();
            if (model) {
                const openingIds: number[] = [];
                for (const fragId in openings) {
                    for (const id of openings[fragId]) {
                        openingIds.push(id);
                    }
                }
                if (openingIds.length > 0) {
                    await (model as any).setColor(openingIds, new THREE.Color("#facc15"));
                    await (model as any).setOpacity(openingIds, 0.4);
                }
            }
        } catch (e) {
            console.warn("setInitialVisibility failed:", e);
        }
    }

    async toggleVisibility(entityName: string, show: boolean) {
        try {
            const classifier = this.components.get(OBC.Classifier);
            const hider = this.components.get(OBC.Hider);
            if (entityName === 'IFCOPENINGELEMENT') {
                const items = await classifier.find({ ["Categories"]: ['IFCOPENINGELEMENT'] });
                await hider.set(show, items);
            } else {
                const items = await classifier.find({ ["Categories"]: [entityName] });
                await hider.set(show, items);
            }
        } catch (e) {
            console.warn(`Failed to toggle visibility for ${entityName}`, e);
        }
    }

    // Toggle all non-space, non-opening categories (the "elements")
    async toggleElementsVisibility(show: boolean) {
        try {
            const classifier = this.components.get(OBC.Classifier);
            const hider = this.components.get(OBC.Hider);
            const categoryGroups = classifier.list.get("Categories");
            if (!categoryGroups) return;
            const excluded = new Set(["IFCSPACE", "IFCOPENINGELEMENT"]);
            for (const [cat] of categoryGroups) {
                if (!excluded.has(cat)) {
                    const items = await classifier.find({ ["Categories"]: [cat] });
                    await hider.set(show, items);
                }
            }
        } catch (e) {
            console.warn(`Failed to toggle elements visibility`, e);
        }
    }

    async toggleExpressIdsVisibility(expressIds: number[], show: boolean) {
        try {
            const [model] = this.fragments.list.values();
            if (!model) return;
            const hider = this.components.get(OBC.Hider);
            const modelIdMap: OBC.ModelIdMap = {
                [model.modelId]: new Set(expressIds)
            };
            await hider.set(show, modelIdMap);
        } catch (e) {
            console.warn(`Failed to toggle express IDs visibility`, e);
        }
    }

    clearNetwork() {
        this.networkGroup.clear();
    }

    drawNetwork(nodes: any[], edges: any[], interLayerConnections: any[] = []) {
        this.clearNetwork();

        const sphereGeo = new THREE.SphereGeometry(0.2, 16, 16);
        const spaceMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // Green for Spaces
        const openingMat = new THREE.MeshBasicMaterial({ color: 0xffa500 }); // Orange for Openings

        const nodesById = new Map();

        for (const n of nodes) {
            const mat = n.type === "Opening" ? openingMat : spaceMat;
            const mesh = new THREE.Mesh(sphereGeo, mat);
            mesh.position.set(n.centroid.x, n.centroid.y, n.centroid.z);
            this.networkGroup.add(mesh);
            nodesById.set(n.id, n);
        }

        const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });

        for (const e of edges) {
            const n1 = nodesById.get(e.from);
            const n2 = nodesById.get(e.to);
            if (n1 && n2) {
                const pts = [
                    new THREE.Vector3(n1.centroid.x, n1.centroid.y, n1.centroid.z),
                    new THREE.Vector3(n2.centroid.x, n2.centroid.y, n2.centroid.z)
                ];
                const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
                const line = new THREE.Line(lineGeo, lineMat);
                this.networkGroup.add(line);
            }
        }

        // Draw InterLayerConnections as dashed pink lines
        const ilcMat = new THREE.LineDashedMaterial({
            color: 0xec4899,
            dashSize: 0.4,
            gapSize: 0.2
        });

        for (const ilc of interLayerConnections) {
            const n1 = nodesById.get(ilc.fromNodeId);
            const n2 = nodesById.get(ilc.toNodeId);
            if (n1 && n2) {
                const pts = [
                    new THREE.Vector3(n1.centroid.x, n1.centroid.y, n1.centroid.z),
                    new THREE.Vector3(n2.centroid.x, n2.centroid.y, n2.centroid.z)
                ];
                const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
                const line = new THREE.Line(lineGeo, ilcMat);
                line.computeLineDistances();
                this.networkGroup.add(line);
            }
        }
    }
}

