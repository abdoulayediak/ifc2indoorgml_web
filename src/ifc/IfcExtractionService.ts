import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import {
    IFCRELSPACEBOUNDARY,
    IFCPROJECT,
    IFCBUILDING,
    IFCBUILDINGSTOREY,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
    IFCSITE,
    IFCRELAGGREGATES,
    IFCRELVOIDSELEMENT,
    IFCRELFILLSELEMENT
} from 'web-ifc';
import { Node, Edge } from '../network/IndoorNetworkService';

export type ElementCategory = "furniture" | "equipment" | "structure" | "other";

export interface SpatialElementItem {
    ifcId: number;
    name: string;
    type: string;
    category: ElementCategory;
    spaceIfcId?: number;
    spaceName?: string;
    isContainedInSpace?: boolean;
}

export interface SpatialHierarchy {
    projectName: string;
    siteName: string;
    buildingName: string;
    storeys: {
        id: number;
        name: string;
        spaces: { ifcId: number; name: string }[];
        openings: { ifcId: number; name: string; type: string }[];
        elements: SpatialElementItem[];
    }[];
}

export function categorizeIfcElement(ifcType: string, name?: string): ElementCategory {
    const t = (ifcType || "").toUpperCase();
    const n = (name || "").toUpperCase();

    // 1. Furniture & Furnishing
    if (t.includes("FURNIT") || t.includes("FURNISHING") || 
        n.includes("CHAIR") || n.includes("TABLE") || n.includes("DESK") || n.includes("SOFA") || 
        n.includes("CABINET") || n.includes("SHELF") || n.includes("BED") || n.includes("SEAT") ||
        n.includes("BENCH") || n.includes("WARDROBE") || n.includes("CUPBOARD")) {
        return "furniture";
    }

    // 2. Equipment / MEP / Terminals / Appliances / Sensors
    if (t.includes("TERMINAL") || t.includes("APPLIANCE") || t.includes("FIXTURE") ||
        t.includes("EQUIPMENT") || t.includes("FLOW") || t.includes("DISTRIBUTION") ||
        t.includes("SENSOR") || t.includes("ALARM") || t.includes("ACTUATOR") ||
        t.includes("CONTROLLER") || t.includes("PUMP") || t.includes("FAN") ||
        t.includes("UNIT") || t.includes("ELECTRIC") || t.includes("COMMUNICATION") ||
        t.includes("AUDIOVISUAL") || t.includes("FIREPROTECTION") || t.includes("SANITARY")) {
        return "equipment";
    }

    // 3. Structure & Architectural Building Elements
    if (t.includes("WALL") || t.includes("SLAB") || t.includes("COLUMN") ||
        t.includes("BEAM") || t.includes("COVERING") || t.includes("RAILING") ||
        t.includes("STAIR") || t.includes("ROOF") || t.includes("MEMBER") ||
        t.includes("PLATE") || t.includes("CURTAINWALL") || t.includes("FOOTING") ||
        t.includes("BUILDINGELEMENT") || t.includes("CHIMNEY") || t.includes("RAMP") ||
        t.includes("SHADINGDEVICE") || t.includes("REINFORCING") || t.includes("TENDON")) {
        return "structure";
    }

    return "other";
}

export class IfcExtractionService {

    static async extract(components: OBC.Components, model: any) {
        const nodes: Node[] = [];
        const edges: Edge[] = [];
        let hasSpace = false;
        let spatialHierarchy: SpatialHierarchy = {
            projectName: "IFC Project",
            siteName: "IFC Site",
            buildingName: "IFC Building",
            storeys: []
        };

        try {
            const fragments = components.get(OBC.FragmentsManager);
            const classifier = components.get(OBC.Classifier);
            const ifcLoader = components.get(OBC.IfcLoader);
            const webIfc = ifcLoader.webIfc;

            let modelID = 0;
            if (model && typeof (model as any).modelID === 'number') {
                modelID = (model as any).modelID;
            }

            const getItemTriangles = async (expressId: number) => {
                try {
                    const item = (model as any).getItem(expressId);
                    const geometry = await item.getGeometry();
                    if (geometry) {
                        const triangles = await geometry.getTriangles();
                        if (triangles && triangles.length > 0) {
                            return triangles.flat().map((t: THREE.Triangle) => ({
                                a: { x: t.a.x, y: t.a.y, z: t.a.z },
                                b: { x: t.b.x, y: t.b.y, z: t.b.z },
                                c: { x: t.c.x, y: t.c.y, z: t.c.z }
                            }));
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to get triangles for ${expressId}`, e);
                }
                return undefined;
            };

            // --- 1. Extract IfcSpace items ---
            let spaceItems: any = {};
            let totalSpaces = 0;
            for (let i = 0; i < 6; i++) {
                spaceItems = await classifier.find({ "Categories": ["IFCSPACE"] });
                totalSpaces = 0;
                for (const mId in spaceItems) {
                    const ids = spaceItems[mId];
                    totalSpaces += ids instanceof Set ? ids.size : (ids as any).length || 0;
                }
                if (totalSpaces > 0) break;
                await new Promise(resolve => setTimeout(resolve, 500));
                if (i === 2) await classifier.byCategory();
            }

            hasSpace = totalSpaces > 0;
            if (!hasSpace) return { nodes, edges, hasSpace: false, spatialHierarchy };

            // --- 2. Create Space Nodes ---
            let spaceBboxes: THREE.Box3[] = [];
            try { spaceBboxes = await fragments.getBBoxes(spaceItems); } catch (e) { }

            const spaceNodesMap = new Map<number, Node>();
            let bboxIdx = 0;
            for (const mId in spaceItems) {
                const ids = spaceItems[mId];
                for (const localId of ids) {
                    const bbox = spaceBboxes[bboxIdx];
                    const center = new THREE.Vector3();
                    if (bbox && !bbox.isEmpty()) bbox.getCenter(center);

                    const triangles = await getItemTriangles(localId as number);

                    let spaceName = `Space ${localId}`;
                    try {
                        const spaceObj = webIfc.GetLine(modelID, localId as number);
                        if (spaceObj) {
                            spaceName = spaceObj.Name?.value || spaceObj.LongName?.value || `Space ${localId}`;
                        }
                    } catch (e) { }

                    const node: Node = {
                        id: `space-${mId}-${localId}`,
                        type: "Space",
                        ifcId: localId as number,
                        name: spaceName,
                        centroid: { x: center.x, y: center.y, z: center.z },
                        geometry: triangles,
                        bbox: bbox ? bbox.clone() : undefined
                    };
                    nodes.push(node);
                    spaceNodesMap.set(localId as number, node);
                    bboxIdx++;
                }
            }

            // --- 3. Extract Transition Nodes (Openings) ---
            const filledOpeningIds = new Set<number>();
            const filledElementIds = new Set<number>();
            const elementToOpeningMap = new Map<number, number>();
            try {
                const relFillsIDs = webIfc.GetLineIDsWithType(modelID, IFCRELFILLSELEMENT);
                for (let i = 0; i < relFillsIDs.size(); i++) {
                    const rID = relFillsIDs.get(i);
                    const relObj = webIfc.GetLine(modelID, rID);
                    const openingID = relObj.RelatingOpeningElement?.value;
                    const fillerID = relObj.RelatedBuildingElement?.value;
                    if (openingID && fillerID) {
                        filledOpeningIds.add(openingID);
                        filledElementIds.add(fillerID);
                        elementToOpeningMap.set(fillerID, openingID);
                    }
                }
            } catch (e) {}

            const rawOpeningItems = await classifier.find({ "Categories": ["IFCOPENINGELEMENT"] });
            const rawDoorItems = await classifier.find({ "Categories": ["IFCDOOR"] });
            const rawWindowItems = await classifier.find({ "Categories": ["IFCWINDOW"] });

            const transitionItems: OBC.ModelIdMap = {};

            const addTransitionIds = (rawItems: OBC.ModelIdMap | undefined, filterFn?: (id: number) => boolean) => {
                if (!rawItems) return;
                for (const mId in rawItems) {
                    if (!transitionItems[mId]) {
                        transitionItems[mId] = new Set<number>();
                    }
                    for (const id of rawItems[mId]) {
                        if (!filterFn || filterFn(id)) {
                            transitionItems[mId].add(id);
                        }
                    }
                }
            };

            // Add all opening elements
            addTransitionIds(rawOpeningItems);

            // Add doors and windows that are not filling any opening
            addTransitionIds(rawDoorItems, id => !filledElementIds.has(id));
            addTransitionIds(rawWindowItems, id => !filledElementIds.has(id));

            let transBboxes: THREE.Box3[] = [];
            if (transitionItems) {
                try { transBboxes = await fragments.getBBoxes(transitionItems); } catch (e) { }
            }

            const transitionNodesMap = new Map<number, Node>();
            let trBboxIdx = 0;
            for (const mId in transitionItems) {
                const ids = transitionItems[mId];
                for (const localId of ids) {
                    const bbox = transBboxes[trBboxIdx];
                    const center = new THREE.Vector3();
                    if (bbox && !bbox.isEmpty()) bbox.getCenter(center);

                    const triangles = await getItemTriangles(localId as number);

                    let transName = `Transition ${localId}`;
                    try {
                        const transObj = webIfc.GetLine(modelID, localId as number);
                        if (transObj) {
                            transName = transObj.Name?.value || transObj.LongName?.value || `Transition ${localId}`;
                        }
                    } catch (e) { }

                    const node: Node = {
                        id: `transition-${mId}-${localId}`,
                        type: "Opening",
                        ifcId: localId as number,
                        name: transName,
                        centroid: { x: center.x, y: center.y, z: center.z },
                        geometry: triangles,
                        bbox: bbox ? bbox.clone() : undefined
                    };
                    nodes.push(node);
                    transitionNodesMap.set(localId as number, node);
                    trBboxIdx++;
                }
            }

            // --- 4. Adjacency via IfcRelSpaceBoundary ---
            console.log("[Extraction] Querying IfcRelSpaceBoundary...");
            const boundaryIDs = webIfc.GetLineIDsWithType(modelID, IFCRELSPACEBOUNDARY);
            console.log(`[Extraction] Found ${boundaryIDs.size()} boundaries`);

            let edgeCounter = 0;
            for (let i = 0; i < boundaryIDs.size(); i++) {
                try {
                    const bID = boundaryIDs.get(i);
                    const boundary = webIfc.GetLine(modelID, bID);

                    const spaceID = boundary.RelatingSpace?.value;
                    const elementID = boundary.RelatedBuildingElement?.value;

                    if (spaceID && elementID) {
                        const sNode = spaceNodesMap.get(spaceID);
                        
                        let tNode = transitionNodesMap.get(elementID);
                        if (!tNode) {
                            // Try mapping door/window to opening if linked via RelFills
                            const openingID = elementToOpeningMap.get(elementID);
                            if (openingID) {
                                tNode = transitionNodesMap.get(openingID);
                            }
                        }

                        if (sNode && tNode) {
                            edges.push({
                                id: `edge-rel-${edgeCounter++}`,
                                from: sNode.id,
                                to: tNode.id
                            });
                        }
                    }
                } catch (e) { }
            }

            // --- 5. Extract Storey spatial hierarchy ---
            const storeysMap = new Map<number, { 
                id: number; 
                name: string; 
                spaces: { ifcId: number; name: string }[]; 
                openings: { ifcId: number; name: string; type: string }[]; 
                elements: SpatialElementItem[]; 
            }>();
            try {
                const projectIDs = webIfc.GetLineIDsWithType(modelID, IFCPROJECT);
                if (projectIDs.size() > 0) {
                    const proj = webIfc.GetLine(modelID, projectIDs.get(0));
                    spatialHierarchy.projectName = proj.Name?.value || spatialHierarchy.projectName;
                }

                const siteIDs = webIfc.GetLineIDsWithType(modelID, IFCSITE);
                if (siteIDs.size() > 0) {
                    const siteObj = webIfc.GetLine(modelID, siteIDs.get(0));
                    spatialHierarchy.siteName = siteObj.Name?.value || "IFC Site";
                } else {
                    spatialHierarchy.siteName = "IFC Site";
                }

                const buildingIDs = webIfc.GetLineIDsWithType(modelID, IFCBUILDING);
                if (buildingIDs.size() > 0) {
                    const bld = webIfc.GetLine(modelID, buildingIDs.get(0));
                    spatialHierarchy.buildingName = bld.Name?.value || spatialHierarchy.buildingName;
                }

                const storeyIDs = webIfc.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
                const storeyIdsSet = new Set<number>();
                for (let i = 0; i < storeyIDs.size(); i++) {
                    const sID = storeyIDs.get(i);
                    const storeyObj = webIfc.GetLine(modelID, sID);
                    storeyIdsSet.add(sID);
                    storeysMap.set(sID, {
                        id: sID,
                        name: storeyObj.Name?.value || `Storey ${sID}`,
                        spaces: [],
                        openings: [],
                        elements: []
                    });
                }

                // Build parent map from all spatial relationships
                const parentMap = new Map<number, number>();

                // 1. IfcRelAggregates
                const relAggregatesIDs = webIfc.GetLineIDsWithType(modelID, IFCRELAGGREGATES);
                for (let i = 0; i < relAggregatesIDs.size(); i++) {
                    const rID = relAggregatesIDs.get(i);
                    const relObj = webIfc.GetLine(modelID, rID);
                    const parentID = relObj.RelatingObject?.value;
                    const related = relObj.RelatedObjects;
                    if (parentID && related) {
                        for (let j = 0; j < related.length; j++) {
                            const childID = related[j].value;
                            parentMap.set(childID, parentID);
                        }
                    }
                }

                // 2. IfcRelContainedInSpatialStructure
                const elementToSpaceRelMap = new Map<number, number>();
                const relContainedIDs = webIfc.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
                for (let i = 0; i < relContainedIDs.size(); i++) {
                    const rID = relContainedIDs.get(i);
                    const relObj = webIfc.GetLine(modelID, rID);
                    const parentID = relObj.RelatingStructure?.value;
                    const related = relObj.RelatedElements;
                    if (parentID && related) {
                        for (let j = 0; j < related.length; j++) {
                            const childID = related[j].value;
                            parentMap.set(childID, parentID);
                            if (spaceNodesMap.has(parentID)) {
                                elementToSpaceRelMap.set(childID, parentID);
                            }
                        }
                    }
                }

                // 3. IfcRelVoidsElement
                const relVoidsIDs = webIfc.GetLineIDsWithType(modelID, IFCRELVOIDSELEMENT);
                for (let i = 0; i < relVoidsIDs.size(); i++) {
                    const rID = relVoidsIDs.get(i);
                    const relObj = webIfc.GetLine(modelID, rID);
                    const parentID = relObj.RelatingBuildingElement?.value;
                    const childID = relObj.RelatedOpeningElement?.value;
                    if (parentID && childID) {
                        parentMap.set(childID, parentID);
                    }
                }

                // 4. IfcRelFillsElement
                const relFillsIDs = webIfc.GetLineIDsWithType(modelID, IFCRELFILLSELEMENT);
                for (let i = 0; i < relFillsIDs.size(); i++) {
                    const rID = relFillsIDs.get(i);
                    const relObj = webIfc.GetLine(modelID, rID);
                    const parentID = relObj.RelatingOpeningElement?.value;
                    const childID = relObj.RelatedBuildingElement?.value;
                    if (parentID && childID) {
                        parentMap.set(childID, parentID);
                    }
                }

                // Helper to resolve containing space ID (via IfcRelContained or ancestor)
                const getContainingSpaceId = (expressId: number): number | undefined => {
                    if (elementToSpaceRelMap.has(expressId)) {
                        return elementToSpaceRelMap.get(expressId);
                    }
                    let currentId = expressId;
                    const visited = new Set<number>();
                    while (currentId) {
                        if (spaceNodesMap.has(currentId)) {
                            return currentId;
                        }
                        if (visited.has(currentId)) break;
                        visited.add(currentId);
                        const parentId = parentMap.get(currentId);
                        if (!parentId) break;
                        currentId = parentId;
                    }
                    return undefined;
                };

                // Helper to resolve the containing storey ID
                const getStoreyId = (expressId: number): number | undefined => {
                    let currentId = expressId;
                    const visited = new Set<number>();
                    while (currentId) {
                        if (storeyIdsSet.has(currentId)) {
                            return currentId;
                        }
                        if (visited.has(currentId)) {
                            break;
                        }
                        visited.add(currentId);
                        const parentId = parentMap.get(currentId);
                        if (!parentId) {
                            break;
                        }
                        currentId = parentId;
                    }
                    return undefined;
                };

                // Fallback: collect all geometry IDs and find ones not yet assigned
                let allGeometryIds: number[] = [];
                try {
                    allGeometryIds = await model.getItemsIdsWithGeometry();
                } catch (e) {
                    console.warn("Failed to get all geometry IDs for fallback storey mapping:", e);
                }

                const spaceIdsSet = new Set(spaceNodesMap.keys());
                const transitionIdsSet = new Set(transitionNodesMap.keys());
                const otherElementIds = allGeometryIds.filter(id => !spaceIdsSet.has(id) && !transitionIdsSet.has(id));

                const unassignedSpaces: { ifcId: number; name: string }[] = [];
                const unassignedOpenings: { ifcId: number; name: string; type: string }[] = [];
                const unassignedElements: SpatialElementItem[] = [];

                // 1. Map spaces
                for (const spaceId of spaceNodesMap.keys()) {
                    const node = spaceNodesMap.get(spaceId)!;
                    const name = node.name || `Space ${spaceId}`;
                    const storeyId = getStoreyId(spaceId);
                    if (storeyId && storeysMap.has(storeyId)) {
                        node.storeyName = storeysMap.get(storeyId)!.name;
                        storeysMap.get(storeyId)!.spaces.push({ ifcId: spaceId, name });
                    } else {
                        unassignedSpaces.push({ ifcId: spaceId, name });
                    }
                }

                // 2. Map openings
                for (const transId of transitionNodesMap.keys()) {
                    const node = transitionNodesMap.get(transId)!;
                    const name = node.name || `Opening ${transId}`;
                    const type = name.toLowerCase().includes("door") ? "IFCDOOR" : name.toLowerCase().includes("window") ? "IFCWINDOW" : "IFCOPENINGELEMENT";
                    node.subType = type === "IFCWINDOW" ? "Window" : "Door";
                    const storeyId = getStoreyId(transId);
                    if (storeyId && storeysMap.has(storeyId)) {
                        node.storeyName = storeysMap.get(storeyId)!.name;
                        storeysMap.get(storeyId)!.openings.push({ ifcId: transId, name, type });
                    } else {
                        unassignedOpenings.push({ ifcId: transId, name, type });
                    }
                }

                // 3. Map other elements (furniture, equipment, architectural elements)
                let elementBboxes: THREE.Box3[] = [];
                if (otherElementIds.length > 0) {
                    try {
                        elementBboxes = await fragments.getBBoxes({ [modelID]: new Set(otherElementIds) });
                    } catch (e) {
                        console.warn("Could not get bounding boxes for other elements", e);
                    }
                }

                let elBboxIdx = 0;
                for (const elID of otherElementIds) {
                    let elType = "UNKNOWN";
                    let elName = "";
                    try {
                        const element = webIfc.GetLine(modelID, elID);
                        if (element) {
                            elType = webIfc.GetNameFromTypeCode(element.type) || "UNKNOWN";
                            elName = element.Name?.value || element.LongName?.value || `${elType} ${elID}`;
                        }
                    } catch (e) {}

                    const bbox = elementBboxes[elBboxIdx];
                    const center = new THREE.Vector3();
                    if (bbox && !bbox.isEmpty()) bbox.getCenter(center);

                    const storeyId = getStoreyId(elID);
                    const storeyName = storeyId && storeysMap.has(storeyId) ? storeysMap.get(storeyId)!.name : undefined;

                    // Classify element
                    const category = categorizeIfcElement(elType, elName);

                    // Space containment via IfcRelContained or geometric fallback
                    let spaceId = getContainingSpaceId(elID);
                    if (!spaceId && bbox && !bbox.isEmpty()) {
                        for (const [sId, sNode] of spaceNodesMap.entries()) {
                            if (sNode.bbox && sNode.bbox.containsPoint(center)) {
                                spaceId = sId;
                                break;
                            }
                        }
                    }
                    const spaceNode = spaceId ? spaceNodesMap.get(spaceId) : undefined;
                    const spaceName = spaceNode ? spaceNode.name : undefined;
                    const isContained = !!spaceId;

                    // Create element node so it can be added to custom thematic layers and participate in ILC
                    const node: Node = {
                        id: `element-${modelID}-${elID}`,
                        type: "Element",
                        subType: elType,
                        ifcId: elID,
                        name: elName,
                        centroid: { x: center.x, y: center.y, z: center.z },
                        bbox: bbox ? bbox.clone() : undefined,
                        storeyName: storeyName,
                        spaceIfcId: spaceId,
                        spaceName: spaceName,
                        elementCategory: category,
                        isContainedInSpace: isContained
                    };
                    nodes.push(node);

                    const elItem: SpatialElementItem = {
                        ifcId: elID,
                        name: elName,
                        type: elType,
                        category: category,
                        spaceIfcId: spaceId,
                        spaceName: spaceName,
                        isContainedInSpace: isContained
                    };

                    if (storeyId && storeysMap.has(storeyId)) {
                        storeysMap.get(storeyId)!.elements.push(elItem);
                    } else {
                        unassignedElements.push(elItem);
                    }
                    elBboxIdx++;
                }

                if (unassignedSpaces.length > 0 || unassignedOpenings.length > 0 || unassignedElements.length > 0) {
                    storeysMap.set(999999, {
                        id: 999999,
                        name: "Unassigned Elements",
                        spaces: unassignedSpaces,
                        openings: unassignedOpenings,
                        elements: unassignedElements
                    });
                }

                spatialHierarchy.storeys = Array.from(storeysMap.values());

            } catch (e) {
                console.warn("Failed to extract spatial hierarchy", e);
            }

        } catch (e) {
            console.error("IfcExtractionService error:", e);
        }

        console.log(`Extraction complete: ${nodes.length} nodes, ${edges.length} edges`);
        return { nodes, edges, hasSpace, spatialHierarchy };
    }

    /**
     * Computes box-to-box intersections between spaces and slightly inflated openings.
     */
    static computeBoxIntersections(nodes: Node[], baseEdges: Edge[], inflation = 0.05): Edge[] {
        const spaceNodes = nodes.filter(n => n.type === 'Space');
        const openingNodes = nodes.filter(n => n.type === 'Opening');
        const extraEdges: Edge[] = [];

        // Track existing connections to avoid duplicates
        const existingConnections = new Set<string>();
        for (const edge of baseEdges) {
            const pair = [edge.from, edge.to].sort().join(' <-> ');
            existingConnections.add(pair);
        }

        let edgeCounter = baseEdges.length;

        for (const space of spaceNodes) {
            if (!space.bbox) continue;
            for (const opening of openingNodes) {
                if (!opening.bbox) continue;

                // Slightly inflate opening bounding box
                const inflatedOpeningBbox = opening.bbox.clone().expandByScalar(inflation);

                if (inflatedOpeningBbox.intersectsBox(space.bbox)) {
                    const pair = [space.id, opening.id].sort().join(' <-> ');
                    if (!existingConnections.has(pair)) {
                        extraEdges.push({
                            id: `edge-box-${edgeCounter++}`,
                            from: space.id,
                            to: opening.id
                        });
                        existingConnections.add(pair);
                    }
                }
            }
        }

        console.log(`Computed ${extraEdges.length} extra box-to-box intersection edges`);
        return extraEdges;
    }
}

