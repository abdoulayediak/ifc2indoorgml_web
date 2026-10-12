import { Node, Edge } from '../network/IndoorNetworkService';

export type ThemeLayerValue = "Physical" | "Virtual" | "Tags" | "Unknown" | string;
export type TopoExpressionValue = "Contains" | "Overlaps" | "Equals" | "Within" | "Crosses" | "Other" | string;

export interface Layer {
    id: string;
    name: string;
    nodeIds: string[];
    theme?: ThemeLayerValue;
    semanticExtension?: boolean;
}

export interface InterLayerConnection {
    id: string;
    fromLayerId: string;
    toLayerId: string;
    fromNodeId?: string;
    toNodeId?: string;
    typeOfTopoExpression: TopoExpressionValue;
    comment?: string;
    level?: "space" | "layer";
}

export class IndoorGmlExportService {

    private static normalizeTheme(theme?: string): string {
        const standardThemes = ["Physical", "Virtual", "Tags", "Unknown"];
        if (theme && standardThemes.includes(theme)) {
            return theme;
        }
        if (theme && /^other: \w{2,}$/.test(theme)) {
            return theme;
        }
        if (theme && /^other:\w{2,}$/.test(theme)) {
            return `other: ${theme.slice(6)}`;
        }
        return "Physical";
    }

    private static normalizeTopo(topo?: string): string {
        const standardTopo = ["Contains", "Overlaps", "Equals", "Within", "Crosses", "Other"];
        if (topo && standardTopo.includes(topo)) {
            return topo;
        }
        if (topo && /^other: \w{2,}$/.test(topo)) {
            return topo;
        }
        if (topo && /^other:\w{2,}$/.test(topo)) {
            return `other: ${topo.slice(6)}`;
        }
        return "Overlaps";
    }

    static buildXmlDocument(
        nodes: Node[], 
        edges: Edge[], 
        layersList: Layer[] = [], 
        interLayerConnections: InterLayerConnection[] = [], 
        modelName: string = "IndoorModel"
    ): XMLDocument {
        const NS_CORE = "http://www.opengis.net/indoorgml/2.0/core";
        const NS_NAVI = "http://www.opengis.net/indoorgml/2.0/navi";
        const NS_GML = "http://www.opengis.net/gml/3.2";
        const NS_XLINK = "http://www.w3.org/1999/xlink";
        const NS_XSI = "http://www.w3.org/2001/XMLSchema-instance";

        const doc = document.implementation.createDocument(NS_CORE, "IndoorFeatures", null);
        const root = doc.documentElement;

        root.setAttribute("xmlns", NS_CORE);
        root.setAttribute("xmlns:core", NS_CORE);
        root.setAttribute("xmlns:navi", NS_NAVI);
        root.setAttribute("xmlns:gml", NS_GML);
        root.setAttribute("xmlns:xlink", NS_XLINK);
        root.setAttribute("xmlns:xsi", NS_XSI);
        root.setAttribute("xsi:schemaLocation", `${NS_CORE} IndoorGML_core.xsd ${NS_NAVI} IndoorGML_navi.xsd`);
        root.setAttribute("gml:id", "igml_1");

        // Optional GML model name
        const gmlName = doc.createElementNS(NS_GML, "gml:name");
        gmlName.textContent = modelName.replace(/\.gml$/i, "");
        root.appendChild(gmlName);

        // Ensure active layers have at least one layer
        let activeLayers = [...layersList];
        if (activeLayers.length === 0) {
            // If no ThematicLayer is specified, the whole model is considered as a single default layer
            // with only the IfcSpace and the openings as cellSpaces
            const defaultNodes = nodes.filter(n => n.type === "Space" || n.type === "Opening");
            activeLayers.push({
                id: "l_default",
                name: "Default Physical Layer",
                nodeIds: defaultNodes.map(n => n.id),
                theme: "Physical"
            });
        }

        // Filter layers that have at least one node to fulfill minOccurs="1" requirements
        const validLayers = activeLayers.filter(layer => 
            nodes.some(n => layer.nodeIds.includes(n.id))
        );

        const layersToExport = validLayers.length > 0 ? validLayers : activeLayers;

        // --- 1. Export Layers (<layers>) ---
        layersToExport.forEach(layer => {
            const layerNodes = nodes.filter(n => layer.nodeIds.includes(n.id));
            if (layerNodes.length === 0) return;

            const layerEdges = edges.filter(e => 
                layer.nodeIds.includes(e.from) && layer.nodeIds.includes(e.to)
            );

            const layersProp = doc.createElementNS(NS_CORE, "layers");
            root.appendChild(layersProp);

            const thematicLayer = doc.createElementNS(NS_CORE, "ThematicLayer");
            thematicLayer.setAttribute("gml:id", `tl_${layer.id}`);
            layersProp.appendChild(thematicLayer);

            const tlName = doc.createElementNS(NS_GML, "gml:name");
            tlName.textContent = layer.name;
            thematicLayer.appendChild(tlName);

            // semanticExtension: true if layer contains navigation elements (TransferSpace) or if specified
            const hasSemanticExtension = layer.semanticExtension ?? layerNodes.some(n => n.type === "Opening");
            const semanticExt = doc.createElementNS(NS_CORE, "semanticExtension");
            semanticExt.textContent = hasSemanticExtension ? "true" : "false";
            thematicLayer.appendChild(semanticExt);

            // theme: strictly conforming to ThemeLayerValueType
            const theme = doc.createElementNS(NS_CORE, "theme");
            theme.textContent = this.normalizeTheme(layer.theme);
            thematicLayer.appendChild(theme);

            // primalSpace (contains PrimalSpaceLayer)
            const primalSpace = doc.createElementNS(NS_CORE, "primalSpace");
            thematicLayer.appendChild(primalSpace);

            const primalSpaceLayer = doc.createElementNS(NS_CORE, "PrimalSpaceLayer");
            primalSpaceLayer.setAttribute("gml:id", `psl_${layer.id}`);
            primalSpace.appendChild(primalSpaceLayer);

            const creationDatePrimal = doc.createElementNS(NS_CORE, "creationDate");
            creationDatePrimal.textContent = new Date().toISOString();
            primalSpaceLayer.appendChild(creationDatePrimal);

            // Export cell spaces in primal space
            layerNodes.forEach(n => {
                const cellId = n.type === "Opening" ? `TransferSpace_${n.ifcId}` : `CellSpace_${n.ifcId}`;
                const nodeId = `Node_${n.ifcId}`;

                const cellSpaceMember = doc.createElementNS(NS_CORE, "cellSpaceMember");
                primalSpaceLayer.appendChild(cellSpaceMember);

                let cellSpace: Element;
                if (n.type === "Opening") {
                    cellSpace = doc.createElementNS(NS_NAVI, "navi:TransferSpace");
                } else {
                    cellSpace = doc.createElementNS(NS_CORE, "CellSpace");
                }
                cellSpace.setAttribute("gml:id", cellId);

                const csName = doc.createElementNS(NS_GML, "gml:name");
                csName.textContent = n.name || cellId;
                cellSpace.appendChild(csName);

                // 1. cellSpaceGeom (minOccurs="0" in CellSpaceType)
                if (n.geometry && n.geometry.length > 0) {
                    const cellSpaceGeom = doc.createElementNS(NS_CORE, "cellSpaceGeom");
                    const csGeom = doc.createElementNS(NS_CORE, "CellSpaceGeometry");
                    const geom3D = doc.createElementNS(NS_CORE, "Geometry3D");
                    
                    const solid = doc.createElementNS(NS_GML, "gml:Solid");
                    solid.setAttribute("gml:id", `Solid_${n.ifcId}`);
                    const exterior = doc.createElementNS(NS_GML, "gml:exterior");
                    const shell = doc.createElementNS(NS_GML, "gml:Shell");

                    n.geometry.forEach((tri, idx) => {
                        const surfaceMember = doc.createElementNS(NS_GML, "gml:surfaceMember");
                        const polygon = doc.createElementNS(NS_GML, "gml:Polygon");
                        polygon.setAttribute("gml:id", `Poly_${n.ifcId}_${idx}`);
                        const polyExt = doc.createElementNS(NS_GML, "gml:exterior");
                        const linearRing = doc.createElementNS(NS_GML, "gml:LinearRing");
                        const posList = doc.createElementNS(NS_GML, "gml:posList");
                        
                        posList.textContent = `${tri.a.x} ${tri.a.y} ${tri.a.z} ${tri.b.x} ${tri.b.y} ${tri.b.z} ${tri.c.x} ${tri.c.y} ${tri.c.z} ${tri.a.x} ${tri.a.y} ${tri.a.z}`;
                        
                        linearRing.appendChild(posList);
                        polyExt.appendChild(linearRing);
                        polygon.appendChild(polyExt);
                        surfaceMember.appendChild(polygon);
                        shell.appendChild(surfaceMember);
                    });

                    exterior.appendChild(shell);
                    solid.appendChild(exterior);
                    geom3D.appendChild(solid);
                    csGeom.appendChild(geom3D);
                    cellSpaceGeom.appendChild(csGeom);
                    cellSpace.appendChild(cellSpaceGeom);
                }

                // 2. level (minOccurs="0" in CellSpaceType)
                if (n.storeyName) {
                    const level = doc.createElementNS(NS_CORE, "level");
                    level.textContent = n.storeyName;
                    cellSpace.appendChild(level);
                }

                // 3. PoI (REQUIRED boolean in CellSpaceType)
                const poI = doc.createElementNS(NS_CORE, "PoI");
                poI.textContent = "false";
                cellSpace.appendChild(poI);

                // 4. cellSpaceName (minOccurs="0" in CellSpaceType)
                const cellSpaceName = doc.createElementNS(NS_CORE, "cellSpaceName");
                cellSpaceName.textContent = n.name || cellId;
                cellSpace.appendChild(cellSpaceName);

                // 5. duality (minOccurs="0" in CellSpaceType)
                const duality = doc.createElementNS(NS_CORE, "duality");
                duality.setAttribute("xlink:href", `#${nodeId}`);
                cellSpace.appendChild(duality);

                // Navigation extensions for TransferSpace
                if (n.type === "Opening") {
                    // 6. locomotionType (NavigableSpaceType)
                    const locomotionType = doc.createElementNS(NS_NAVI, "navi:locomotionType");
                    locomotionType.textContent = "Walking";
                    cellSpace.appendChild(locomotionType);

                    // 7. function (TransferSpaceType)
                    const func = doc.createElementNS(NS_NAVI, "navi:function");
                    func.textContent = "ConnectionSpace";
                    cellSpace.appendChild(func);

                    // 8. type (TransferSpaceType)
                    const tType = doc.createElementNS(NS_NAVI, "navi:type");
                    tType.textContent = n.subType === "Window" ? "Window" : "Door";
                    cellSpace.appendChild(tType);
                }

                cellSpaceMember.appendChild(cellSpace);
            });

            // dualSpace (contains DualSpaceLayer)
            const dualSpace = doc.createElementNS(NS_CORE, "dualSpace");
            thematicLayer.appendChild(dualSpace);

            const dualSpaceLayer = doc.createElementNS(NS_CORE, "DualSpaceLayer");
            dualSpaceLayer.setAttribute("gml:id", `dsl_${layer.id}`);
            dualSpace.appendChild(dualSpaceLayer);

            const isLogical = doc.createElementNS(NS_CORE, "isLogical");
            isLogical.textContent = "false";
            dualSpaceLayer.appendChild(isLogical);

            const creationDateDual = doc.createElementNS(NS_CORE, "creationDate");
            creationDateDual.textContent = new Date().toISOString();
            dualSpaceLayer.appendChild(creationDateDual);

            const isDirected = doc.createElementNS(NS_CORE, "isDirected");
            isDirected.textContent = "false";
            dualSpaceLayer.appendChild(isDirected);

            // In DualSpaceLayerType schema sequence: edgeMember MUST precede nodeMember!
            // --- edgeMember sequence ---
            layerEdges.forEach(e => {
                const edgeMember = doc.createElementNS(NS_CORE, "edgeMember");
                dualSpaceLayer.appendChild(edgeMember);

                const edgeId = `Curve_${e.id}`;
                const gmlEdge = doc.createElementNS(NS_CORE, "Edge");
                gmlEdge.setAttribute("gml:id", edgeId);

                const fromNode = nodes.find(n => n.id === e.from);
                const toNode = nodes.find(n => n.id === e.to);

                // Optional Curve Geometry for Edge
                if (fromNode && toNode) {
                    const edgeGeom = doc.createElementNS(NS_CORE, "geometry");
                    const lineString = doc.createElementNS(NS_GML, "gml:LineString");
                    lineString.setAttribute("gml:id", `LineString_${e.id}`);
                    const posList = doc.createElementNS(NS_GML, "gml:posList");
                    posList.textContent = `${fromNode.centroid.x} ${fromNode.centroid.y} ${fromNode.centroid.z} ${toNode.centroid.x} ${toNode.centroid.y} ${toNode.centroid.z}`;
                    lineString.appendChild(posList);
                    edgeGeom.appendChild(lineString);
                    gmlEdge.appendChild(edgeGeom);
                }

                // Weight (double, required)
                const weight = doc.createElementNS(NS_CORE, "weight");
                if (fromNode && toNode) {
                    const dist = Math.hypot(
                        toNode.centroid.x - fromNode.centroid.x,
                        toNode.centroid.y - fromNode.centroid.y,
                        toNode.centroid.z - fromNode.centroid.z
                    );
                    weight.textContent = dist > 0 ? dist.toFixed(3) : "1.0";
                } else {
                    weight.textContent = "1.0";
                }
                gmlEdge.appendChild(weight);

                // Exactly 2 connects elements
                const connects1 = doc.createElementNS(NS_CORE, "connects");
                connects1.setAttribute("xlink:href", `#Node_${fromNode ? fromNode.ifcId : e.from}`);
                gmlEdge.appendChild(connects1);

                const connects2 = doc.createElementNS(NS_CORE, "connects");
                connects2.setAttribute("xlink:href", `#Node_${toNode ? toNode.ifcId : e.to}`);
                gmlEdge.appendChild(connects2);

                edgeMember.appendChild(gmlEdge);
            });

            // --- nodeMember sequence ---
            layerNodes.forEach(n => {
                const nodeId = `Node_${n.ifcId}`;
                const cellId = n.type === "Space" ? `CellSpace_${n.ifcId}` : `TransferSpace_${n.ifcId}`;

                const nodeMember = doc.createElementNS(NS_CORE, "nodeMember");
                dualSpaceLayer.appendChild(nodeMember);

                const gmlNode = doc.createElementNS(NS_CORE, "Node");
                gmlNode.setAttribute("gml:id", nodeId);

                const gmlNodeName = doc.createElementNS(NS_GML, "gml:name");
                gmlNodeName.textContent = n.name || nodeId;
                gmlNode.appendChild(gmlNodeName);

                // Point geometry
                const nodeGeometry = doc.createElementNS(NS_CORE, "geometry");
                const nodePoint = doc.createElementNS(NS_GML, "gml:Point");
                nodePoint.setAttribute("gml:id", `NodePoint_${n.ifcId}`);
                const nodePos = doc.createElementNS(NS_GML, "gml:pos");
                nodePos.textContent = `${n.centroid.x} ${n.centroid.y} ${n.centroid.z}`;
                nodePoint.appendChild(nodePos);
                nodeGeometry.appendChild(nodePoint);
                gmlNode.appendChild(nodeGeometry);

                // Duality
                const stateDuality = doc.createElementNS(NS_CORE, "duality");
                stateDuality.setAttribute("xlink:href", `#${cellId}`);
                gmlNode.appendChild(stateDuality);

                // Connects edges for this node (optional in NodeType schema)
                const connectedEdges = layerEdges.filter(e => e.from === n.id || e.to === n.id);
                connectedEdges.forEach(e => {
                    const conn = doc.createElementNS(NS_CORE, "connects");
                    conn.setAttribute("xlink:href", `#Curve_${e.id}`);
                    gmlNode.appendChild(conn);
                });

                nodeMember.appendChild(gmlNode);
            });
        });

        // --- 2. Export InterLayerConnections (<layerConnections>) ---
        interLayerConnections.forEach(ilc => {
            const connProp = doc.createElementNS(NS_CORE, "layerConnections");
            root.appendChild(connProp);

            const ilcMember = doc.createElementNS(NS_CORE, "InterLayerConnection");
            ilcMember.setAttribute("gml:id", ilc.id);
            connProp.appendChild(ilcMember);

            const typeOfTopoExpression = doc.createElementNS(NS_CORE, "typeOfTopoExpression");
            typeOfTopoExpression.textContent = this.normalizeTopo(ilc.typeOfTopoExpression);
            ilcMember.appendChild(typeOfTopoExpression);

            if (ilc.comment) {
                const comment = doc.createElementNS(NS_CORE, "comment");
                comment.textContent = ilc.comment;
                ilcMember.appendChild(comment);
            }

            const connectedLayers1 = doc.createElementNS(NS_CORE, "connectedLayers");
            connectedLayers1.setAttribute("xlink:href", `#tl_${ilc.fromLayerId}`);
            ilcMember.appendChild(connectedLayers1);

            const connectedLayers2 = doc.createElementNS(NS_CORE, "connectedLayers");
            connectedLayers2.setAttribute("xlink:href", `#tl_${ilc.toLayerId}`);
            ilcMember.appendChild(connectedLayers2);

            const fromNode = nodes.find(n => n.id === ilc.fromNodeId);
            const toNode = nodes.find(n => n.id === ilc.toNodeId);

            if (fromNode && toNode) {
                const fromCellId = fromNode.type === "Opening" ? `TransferSpace_${fromNode.ifcId}` : `CellSpace_${fromNode.ifcId}`;
                const toCellId = toNode.type === "Opening" ? `TransferSpace_${toNode.ifcId}` : `CellSpace_${toNode.ifcId}`;

                const connectedCells1 = doc.createElementNS(NS_CORE, "connectedCells");
                connectedCells1.setAttribute("xlink:href", `#${fromCellId}`);
                ilcMember.appendChild(connectedCells1);

                const connectedCells2 = doc.createElementNS(NS_CORE, "connectedCells");
                connectedCells2.setAttribute("xlink:href", `#${toCellId}`);
                ilcMember.appendChild(connectedCells2);

                const connectedNodes1 = doc.createElementNS(NS_CORE, "connectedNodes");
                connectedNodes1.setAttribute("xlink:href", `#Node_${fromNode.ifcId}`);
                ilcMember.appendChild(connectedNodes1);

                const connectedNodes2 = doc.createElementNS(NS_CORE, "connectedNodes");
                connectedNodes2.setAttribute("xlink:href", `#Node_${toNode.ifcId}`);
                ilcMember.appendChild(connectedNodes2);
            }
        });

        return doc;
    }

    static serializeXml(doc: XMLDocument): string {
        const serializer = new XMLSerializer();
        let rawXml = serializer.serializeToString(doc);

        if (!rawXml.startsWith("<?xml")) {
            rawXml = `<?xml version="1.0" encoding="UTF-8"?>\n${rawXml}`;
        }
        return rawXml;
    }

    static export(
        nodes: Node[], 
        edges: Edge[], 
        layersList: Layer[] = [], 
        interLayerConnections: InterLayerConnection[] = [], 
        fileName: string = "indoor_network.gml"
    ) {
        if (!nodes.some(n => n.type === "Space")) {
            throw new Error("IndoorGML export impossible: no IfcSpace found.");
        }

        const doc = this.buildXmlDocument(nodes, edges, layersList, interLayerConnections, fileName);
        const xmlString = this.serializeXml(doc);

        const blob = new Blob([xmlString], { type: "application/xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
