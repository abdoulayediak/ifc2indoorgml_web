import { ViewerService } from './viewer/ViewerService';
import { IfcExtractionService, SpatialHierarchy } from './ifc/IfcExtractionService';
import { IndoorGmlExportService, Layer, InterLayerConnection } from './indoorgml/IndoorGmlExportService';

async function init() {
    const viewer = new ViewerService('container');
    await viewer.init();

    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const btnGenerate = document.getElementById('btn-generate-network') as HTMLButtonElement;
    const btnExport = document.getElementById('btn-export-indoorgml') as HTMLButtonElement;
    const btnResetView = document.getElementById('btn-reset-view') as HTMLButtonElement;
    const statusDiv = document.getElementById('status-message') as HTMLDivElement;

    // Tab buttons and containers
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tabId = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            if (tabId) {
                const targetTab = document.getElementById(tabId);
                if (targetTab) targetTab.classList.add('active');
            }
        });
    });

    let baseNodes: any[] = [];
    let baseEdges: any[] = [];
    let activeNodes: any[] = [];
    let activeEdges: any[] = [];
    let layers: Layer[] = [];
    let interLayerConnections: InterLayerConnection[] = [];
    let selectedNode: any | null = null;
    let spatialHierarchy: SpatialHierarchy | null = null;
    let currentFileName = "indoor_network.gml";

    // Selected Space Card Elements
    const selectedSpaceBadge = document.getElementById('selected-space-badge');
    const selectedSpaceDetails = document.getElementById('selected-space-details');
    const selectedSpaceActions = document.getElementById('selected-space-actions');
    const quickAssignLayerSelect = document.getElementById('quick-assign-layer-select') as HTMLSelectElement;
    const btnQuickAddToLayer = document.getElementById('btn-quick-add-to-layer') as HTMLButtonElement;

    function updateSelectedSpaceCard() {
        if (!selectedNode) {
            if (selectedSpaceBadge) {
                selectedSpaceBadge.className = "badge-none";
                selectedSpaceBadge.innerText = "None";
            }
            if (selectedSpaceDetails) {
                selectedSpaceDetails.innerHTML = "Click any space or opening in the Hierarchy tree to select it.";
            }
            if (selectedSpaceActions) {
                selectedSpaceActions.style.display = "none";
            }
            return;
        }

        const isSpace = selectedNode.type === "Space";
        const icon = isSpace ? "🛋️" : (selectedNode.subType === "Door" ? "🚪" : selectedNode.subType === "Window" ? "🪟" : "↔️");
        
        if (selectedSpaceBadge) {
            selectedSpaceBadge.className = "badge-selected";
            selectedSpaceBadge.innerText = `${icon} ${selectedNode.type} [${selectedNode.ifcId}]`;
        }

        const containingLayers = layers.filter(l => l.nodeIds.includes(selectedNode.id));
        const layerNamesStr = containingLayers.length > 0 
            ? containingLayers.map(l => `<span style="color:#38bdf8; font-weight:600;">${l.name}</span>`).join(", ")
            : "<em style='color:#94a3b8;'>Not assigned to any layer yet</em>";

        if (selectedSpaceDetails) {
            selectedSpaceDetails.innerHTML = `
                <div><strong>${selectedNode.name || `${selectedNode.type} ${selectedNode.ifcId}`}</strong></div>
                <div style="font-size:0.7rem; color:#94a3b8; margin-top:2px;">
                    Centroid: (${selectedNode.centroid.x.toFixed(2)}, ${selectedNode.centroid.y.toFixed(2)}, ${selectedNode.centroid.z.toFixed(2)})
                </div>
                <div style="font-size:0.7rem; margin-top:2px;">
                    Memberships: ${layerNamesStr}
                </div>
            `;
        }

        if (selectedSpaceActions && quickAssignLayerSelect) {
            const availableLayers = layers.filter(l => !l.nodeIds.includes(selectedNode.id));
            quickAssignLayerSelect.innerHTML = "";
            if (availableLayers.length > 0) {
                availableLayers.forEach(l => {
                    const opt = document.createElement('option');
                    opt.value = l.id;
                    opt.innerText = l.name;
                    quickAssignLayerSelect.appendChild(opt);
                });
                selectedSpaceActions.style.display = "flex";
            } else {
                selectedSpaceActions.style.display = "none";
            }
        }
    }

    if (btnQuickAddToLayer && quickAssignLayerSelect) {
        btnQuickAddToLayer.addEventListener('click', () => {
            if (!selectedNode) return;
            const targetLayerId = quickAssignLayerSelect.value;
            const targetLayer = layers.find(l => l.id === targetLayerId);
            if (targetLayer && !targetLayer.nodeIds.includes(selectedNode.id)) {
                targetLayer.nodeIds.push(selectedNode.id);
                renderLayers();
                updateIlcUI();
                updateSelectedSpaceCard();
                statusDiv.innerText = `Added ${selectedNode.name || selectedNode.id} to layer: ${targetLayer.name}`;
            }
        });
    }

    // 1. Load IFC Event Listener
    fileInput.addEventListener('change', async (event: Event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        currentFileName = file.name.replace(/\.ifc$/i, ".gml");

        try {
            statusDiv.innerText = "Loading IFC...";
            btnGenerate.disabled = true;
            btnExport.disabled = true;
            btnResetView.style.display = 'none';
            viewer.clearNetwork();

            // Clear lists
            layers = [];
            interLayerConnections = [];
            selectedNode = null;
            updateSelectedSpaceCard();
            renderLayers();
            renderIlcList();

            const model = await viewer.loadIfc(file);
            statusDiv.innerText = "IFC Loaded. Extracting properties...";

            const extracted = await IfcExtractionService.extract(viewer.components, model);
            baseNodes = extracted.nodes;
            baseEdges = extracted.edges;
            spatialHierarchy = extracted.spatialHierarchy;

            if (extracted.hasSpace) {
                statusDiv.innerText = "IFC Loaded successfully!";
                btnGenerate.disabled = false;

                // Start with 0 custom layers (default single-layer mode active by default)
                layers = [];

                renderLayers();
                updateIlcUI();
                renderHierarchyTree();
                updateSelectedSpaceCard();
            } else {
                statusDiv.innerText = "IFC Loaded! Note: Missing spaces inside geometry.";
                btnGenerate.disabled = true;
                btnExport.disabled = true;
            }

            btnResetView.style.display = 'inline-flex';

        } catch (e: any) {
            console.error(e);
            statusDiv.innerText = "Error: " + e.message;
        }
    });

    btnResetView.addEventListener('click', () => {
        viewer.resetFocus();
    });

    // 2. Generate Network Event Listener
    btnGenerate.addEventListener('click', () => {
        try {
            statusDiv.innerText = "Generating internal network visualization...";
            regenerateAndDrawNetwork();
            statusDiv.innerText = "Network ready!";
            btnExport.disabled = false;
        } catch (e: any) {
            console.error(e);
            statusDiv.innerText = "Generation Error: " + e.message;
        }
    });

    // 3. Export IndoorGML Event Listener
    btnExport.addEventListener('click', () => {
        try {
            statusDiv.innerText = "Exporting IndoorGML...";
            IndoorGmlExportService.export(activeNodes, activeEdges, layers, interLayerConnections, currentFileName);
            statusDiv.innerText = "Export successful!";
        } catch (e: any) {
            console.error(e);
            statusDiv.innerText = "Export Error: " + e.message;
        }
    });



    // --- Dynamic Network & Bounding Box Intersection ---
    function regenerateAndDrawNetwork() {
        activeNodes = [...baseNodes];
        activeEdges = [...baseEdges];

        const useBoxIntersection = (document.getElementById('checkbox-box-intersection') as HTMLInputElement)?.checked;
        if (useBoxIntersection) {
            const extraEdges = IfcExtractionService.computeBoxIntersections(baseNodes, baseEdges, 0.05);
            activeEdges = [...activeEdges, ...extraEdges];
        }

        viewer.drawNetwork(activeNodes, activeEdges, interLayerConnections);
        if (btnExport) {
            btnExport.disabled = false;
        }
    }

    // --- Spatial Hierarchy Tree Builder ---
    const treeDiv = document.getElementById('hierarchy-tree') as HTMLDivElement;
    const searchInput = document.getElementById('hierarchy-search') as HTMLInputElement;

    function selectSpaceOrNode(node: any, rowEl: HTMLElement) {
        selectedNode = node;
        const allRows = treeDiv.querySelectorAll('.tree-node-row');
        allRows.forEach(r => r.classList.remove('active'));
        rowEl.classList.add('active');

        if (node.centroid) {
            viewer.world.camera.controls.setLookAt(
                node.centroid.x + 8, node.centroid.y + 8, node.centroid.z + 8,
                node.centroid.x, node.centroid.y, node.centroid.z,
                true
            );
        }

        updateSelectedSpaceCard();
        renderLayers();
    }

    function renderHierarchyTree(filterText: string = "") {
        if (!treeDiv || !spatialHierarchy) return;
        treeDiv.innerHTML = "";

        // Build Project Node
        const projectRow = document.createElement('div');
        projectRow.className = "tree-node-row";

        const projToggle = document.createElement('span');
        projToggle.className = "tree-node-toggle";
        projToggle.innerText = "▼";

        const projIcon = document.createElement('span');
        projIcon.className = "tree-node-icon";
        projIcon.innerText = "🏢";

        const projLabel = document.createElement('span');
        projLabel.className = "tree-node-label";
        projLabel.innerText = spatialHierarchy.projectName || "IFC Project";
        projLabel.style.fontWeight = "bold";

        projectRow.appendChild(projToggle);
        projectRow.appendChild(projIcon);
        projectRow.appendChild(projLabel);

        const projectChildren = document.createElement('div');
        projectChildren.className = "tree-node-children expanded";

        // Build Site Node
        const siteRow = document.createElement('div');
        siteRow.className = "tree-node-row";

        const siteToggle = document.createElement('span');
        siteToggle.className = "tree-node-toggle";
        siteToggle.innerText = "▼";

        const siteIcon = document.createElement('span');
        siteIcon.className = "tree-node-icon";
        siteIcon.innerText = "🌍";

        const siteLabel = document.createElement('span');
        siteLabel.className = "tree-node-label";
        siteLabel.innerText = spatialHierarchy.siteName || "IFC Site";
        siteLabel.style.fontWeight = "600";

        siteRow.appendChild(siteToggle);
        siteRow.appendChild(siteIcon);
        siteRow.appendChild(siteLabel);

        const siteChildren = document.createElement('div');
        siteChildren.className = "tree-node-children expanded";

        // Build Building Node
        const buildingRow = document.createElement('div');
        buildingRow.className = "tree-node-row";

        const bldToggle = document.createElement('span');
        bldToggle.className = "tree-node-toggle";
        bldToggle.innerText = "▼";

        const bldIcon = document.createElement('span');
        bldIcon.className = "tree-node-icon";
        bldIcon.innerText = "🏢";

        const bldLabel = document.createElement('span');
        bldLabel.className = "tree-node-label";
        bldLabel.innerText = spatialHierarchy.buildingName || "IFC Building";
        bldLabel.style.fontWeight = "600";

        buildingRow.appendChild(bldToggle);
        buildingRow.appendChild(bldIcon);
        buildingRow.appendChild(bldLabel);

        const buildingChildren = document.createElement('div');
        buildingChildren.className = "tree-node-children expanded";

        // Toggle Expand/Collapse
        projToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            projectChildren.classList.toggle('expanded');
            projToggle.innerText = projectChildren.classList.contains('expanded') ? "▼" : "▶";
        });
        siteToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            siteChildren.classList.toggle('expanded');
            siteToggle.innerText = siteChildren.classList.contains('expanded') ? "▼" : "▶";
        });
        bldToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            buildingChildren.classList.toggle('expanded');
            bldToggle.innerText = buildingChildren.classList.contains('expanded') ? "▼" : "▶";
        });

        // Add Storeys
        spatialHierarchy.storeys.forEach(storey => {
            const hasSpaces = storey.spaces.length > 0;
            const hasOpenings = storey.openings.length > 0;
            const hasElements = storey.elements.length > 0;

            const storeyRow = document.createElement('div');
            storeyRow.className = "tree-node-row";

            const storeyToggle = document.createElement('span');
            storeyToggle.className = "tree-node-toggle";
            storeyToggle.innerText = "▼";

            const storeyCheckbox = document.createElement('input');
            storeyCheckbox.type = "checkbox";
            storeyCheckbox.className = "tree-node-checkbox";
            storeyCheckbox.checked = true;

            const storeyIcon = document.createElement('span');
            storeyIcon.className = "tree-node-icon";
            storeyIcon.innerText = "🪜";

            const storeyLabel = document.createElement('span');
            storeyLabel.className = "tree-node-label";
            storeyLabel.innerText = storey.name;

            storeyRow.appendChild(storeyToggle);
            storeyRow.appendChild(storeyCheckbox);
            storeyRow.appendChild(storeyIcon);
            storeyRow.appendChild(storeyLabel);

            const storeyChildren = document.createElement('div');
            storeyChildren.className = "tree-node-children expanded";

            storeyToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                storeyChildren.classList.toggle('expanded');
                storeyToggle.innerText = storeyChildren.classList.contains('expanded') ? "▼" : "▶";
            });

            storeyCheckbox.addEventListener('change', async () => {
                const spaceIds = storey.spaces.map(s => s.ifcId);
                const openingIds = storey.openings.map(o => o.ifcId);
                const elementIds = storey.elements.map(e => e.ifcId);

                if (storeyCheckbox.checked) {
                    await viewer.toggleExpressIdsVisibility([...spaceIds, ...openingIds], true);
                    const spaceCbs = storeyChildren.querySelectorAll('.group-spaces-container .tree-node-checkbox') as NodeListOf<HTMLInputElement>;
                    spaceCbs.forEach(cb => cb.checked = true);
                    const openingCbs = storeyChildren.querySelectorAll('.group-openings-container .tree-node-checkbox') as NodeListOf<HTMLInputElement>;
                    openingCbs.forEach(cb => cb.checked = true);
                } else {
                    await viewer.toggleExpressIdsVisibility([...spaceIds, ...openingIds, ...elementIds], false);
                    const childCheckboxes = storeyChildren.querySelectorAll('.tree-node-checkbox') as NodeListOf<HTMLInputElement>;
                    childCheckboxes.forEach(cb => cb.checked = false);
                }
            });

            // 1. SPACES GROUP
            if (hasSpaces) {
                const groupRow = document.createElement('div');
                groupRow.className = "tree-node-row group-node";

                const groupToggle = document.createElement('span');
                groupToggle.className = "tree-node-toggle";
                groupToggle.innerText = "▼";

                const groupCheckbox = document.createElement('input');
                groupCheckbox.type = "checkbox";
                groupCheckbox.className = "tree-node-checkbox";
                groupCheckbox.checked = true;

                const groupIcon = document.createElement('span');
                groupIcon.className = "tree-node-icon";
                groupIcon.innerText = "🛋️";

                const groupLabel = document.createElement('span');
                groupLabel.className = "tree-node-label";
                groupLabel.innerText = `Spaces (${storey.spaces.length})`;

                groupRow.appendChild(groupToggle);
                groupRow.appendChild(groupCheckbox);
                groupRow.appendChild(groupIcon);
                groupRow.appendChild(groupLabel);

                const groupChildren = document.createElement('div');
                groupChildren.className = "tree-node-children expanded group-spaces-container";

                groupToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    groupChildren.classList.toggle('expanded');
                    groupToggle.innerText = groupChildren.classList.contains('expanded') ? "▼" : "▶";
                });

                groupCheckbox.addEventListener('change', async () => {
                    const ids = storey.spaces.map(s => s.ifcId);
                    await viewer.toggleExpressIdsVisibility(ids, groupCheckbox.checked);
                    const childCheckboxes = groupChildren.querySelectorAll('.tree-node-checkbox') as NodeListOf<HTMLInputElement>;
                    childCheckboxes.forEach(cb => cb.checked = groupCheckbox.checked);
                });

                storey.spaces.forEach(space => {
                    if (filterText && !space.name?.toLowerCase().includes(filterText.toLowerCase()) && !space.ifcId.toString().includes(filterText)) {
                        return;
                    }
                    const spaceRow = document.createElement('div');
                    spaceRow.className = "tree-node-row leaf-node";
                    if (selectedNode && selectedNode.ifcId === space.ifcId) {
                        spaceRow.classList.add('active');
                    }

                    const spaceIndent = document.createElement('span');
                    spaceIndent.className = "tree-node-toggle";

                    const spaceCheckbox = document.createElement('input');
                    spaceCheckbox.type = "checkbox";
                    spaceCheckbox.className = "tree-node-checkbox";
                    spaceCheckbox.checked = true;
                    spaceCheckbox.dataset.type = "space";
                    spaceCheckbox.dataset.ifcid = space.ifcId.toString();

                    const spaceIcon = document.createElement('span');
                    spaceIcon.className = "tree-node-icon";
                    spaceIcon.innerText = "🛋️";

                    const spaceLabel = document.createElement('span');
                    spaceLabel.className = "tree-node-label";
                    spaceLabel.innerText = `${space.name || `Space ${space.ifcId}`} [${space.ifcId}]`;

                    spaceRow.appendChild(spaceIndent);
                    spaceRow.appendChild(spaceCheckbox);
                    spaceRow.appendChild(spaceIcon);
                    spaceRow.appendChild(spaceLabel);

                    spaceCheckbox.addEventListener('change', async (e) => {
                        e.stopPropagation();
                        await viewer.toggleExpressIdsVisibility([space.ifcId], spaceCheckbox.checked);
                    });

                    spaceRow.addEventListener('click', () => {
                        const baseNode = baseNodes.find(n => n.ifcId === space.ifcId);
                        if (baseNode) {
                            selectSpaceOrNode(baseNode, spaceRow);
                        }
                    });

                    groupChildren.appendChild(spaceRow);
                });

                storeyChildren.appendChild(groupRow);
                storeyChildren.appendChild(groupChildren);
            }

            // 2. OPENINGS GROUP
            if (hasOpenings) {
                const groupRow = document.createElement('div');
                groupRow.className = "tree-node-row group-node";

                const groupToggle = document.createElement('span');
                groupToggle.className = "tree-node-toggle";
                groupToggle.innerText = "▼";

                const groupCheckbox = document.createElement('input');
                groupCheckbox.type = "checkbox";
                groupCheckbox.className = "tree-node-checkbox";
                groupCheckbox.checked = true;

                const groupIcon = document.createElement('span');
                groupIcon.className = "tree-node-icon";
                groupIcon.innerText = "🚪";

                const groupLabel = document.createElement('span');
                groupLabel.className = "tree-node-label";
                groupLabel.innerText = `Openings / Doors / Windows (${storey.openings.length})`;

                groupRow.appendChild(groupToggle);
                groupRow.appendChild(groupCheckbox);
                groupRow.appendChild(groupIcon);
                groupRow.appendChild(groupLabel);

                const groupChildren = document.createElement('div');
                groupChildren.className = "tree-node-children expanded group-openings-container";

                groupToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    groupChildren.classList.toggle('expanded');
                    groupToggle.innerText = groupChildren.classList.contains('expanded') ? "▼" : "▶";
                });

                groupCheckbox.addEventListener('change', async () => {
                    const ids = storey.openings.map(o => o.ifcId);
                    await viewer.toggleExpressIdsVisibility(ids, groupCheckbox.checked);
                    const childCheckboxes = groupChildren.querySelectorAll('.tree-node-checkbox') as NodeListOf<HTMLInputElement>;
                    childCheckboxes.forEach(cb => cb.checked = groupCheckbox.checked);
                });

                storey.openings.forEach(opening => {
                    if (filterText && !opening.name?.toLowerCase().includes(filterText.toLowerCase()) && !opening.ifcId.toString().includes(filterText)) {
                        return;
                    }
                    const openingRow = document.createElement('div');
                    openingRow.className = "tree-node-row leaf-node";
                    if (selectedNode && selectedNode.ifcId === opening.ifcId) {
                        openingRow.classList.add('active');
                    }

                    const openingIndent = document.createElement('span');
                    openingIndent.className = "tree-node-toggle";

                    const openingCheckbox = document.createElement('input');
                    openingCheckbox.type = "checkbox";
                    openingCheckbox.className = "tree-node-checkbox";
                    openingCheckbox.checked = true;
                    openingCheckbox.dataset.type = "opening";
                    openingCheckbox.dataset.ifcid = opening.ifcId.toString();

                    const openingIcon = document.createElement('span');
                    openingIcon.className = "tree-node-icon";
                    openingIcon.innerText = opening.type === "IFCDOOR" ? "🚪" : opening.type === "IFCWINDOW" ? "🪟" : "↔️";

                    const openingLabel = document.createElement('span');
                    openingLabel.className = "tree-node-label";
                    openingLabel.innerText = `${opening.name || `Opening ${opening.ifcId}`} [${opening.ifcId}] (${opening.type.replace("IFC", "")})`;

                    openingRow.appendChild(openingIndent);
                    openingRow.appendChild(openingCheckbox);
                    openingRow.appendChild(openingIcon);
                    openingRow.appendChild(openingLabel);

                    openingCheckbox.addEventListener('change', async (e) => {
                        e.stopPropagation();
                        await viewer.toggleExpressIdsVisibility([opening.ifcId], openingCheckbox.checked);
                    });

                    openingRow.addEventListener('click', () => {
                        const baseNode = baseNodes.find(n => n.ifcId === opening.ifcId);
                        if (baseNode) {
                            selectSpaceOrNode(baseNode, openingRow);
                        }
                    });

                    groupChildren.appendChild(openingRow);
                });

                storeyChildren.appendChild(groupRow);
                storeyChildren.appendChild(groupChildren);
            }

            // 3. ELEMENTS GROUP
            if (hasElements) {
                const groupRow = document.createElement('div');
                groupRow.className = "tree-node-row group-node";

                const groupToggle = document.createElement('span');
                groupToggle.className = "tree-node-toggle";
                groupToggle.innerText = "▼";

                const groupCheckbox = document.createElement('input');
                groupCheckbox.type = "checkbox";
                groupCheckbox.className = "tree-node-checkbox";
                groupCheckbox.checked = false;

                const groupIcon = document.createElement('span');
                groupIcon.className = "tree-node-icon";
                groupIcon.innerText = "🧱";

                const groupLabel = document.createElement('span');
                groupLabel.className = "tree-node-label";
                groupLabel.innerText = `Elements (${storey.elements.length})`;

                groupRow.appendChild(groupToggle);
                groupRow.appendChild(groupCheckbox);
                groupRow.appendChild(groupIcon);
                groupRow.appendChild(groupLabel);

                const groupChildren = document.createElement('div');
                groupChildren.className = "tree-node-children expanded group-elements-container";

                groupToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    groupChildren.classList.toggle('expanded');
                    groupToggle.innerText = groupChildren.classList.contains('expanded') ? "▼" : "▶";
                });

                groupCheckbox.addEventListener('change', async () => {
                    const ids = storey.elements.map(el => el.ifcId);
                    await viewer.toggleExpressIdsVisibility(ids, groupCheckbox.checked);
                    const childCheckboxes = groupChildren.querySelectorAll('.tree-node-checkbox') as NodeListOf<HTMLInputElement>;
                    childCheckboxes.forEach(cb => cb.checked = groupCheckbox.checked);
                });

                storey.elements.forEach(element => {
                    if (filterText && !element.name?.toLowerCase().includes(filterText.toLowerCase()) && !element.ifcId.toString().includes(filterText)) {
                        return;
                    }
                    const elRow = document.createElement('div');
                    elRow.className = "tree-node-row leaf-node";

                    const elIndent = document.createElement('span');
                    elIndent.className = "tree-node-toggle";

                    const elCheckbox = document.createElement('input');
                    elCheckbox.type = "checkbox";
                    elCheckbox.className = "tree-node-checkbox";
                    elCheckbox.checked = false;
                    elCheckbox.dataset.type = "element";
                    elCheckbox.dataset.ifcid = element.ifcId.toString();
                    elCheckbox.dataset.category = element.category;
                    elCheckbox.dataset.contained = element.isContainedInSpace ? "true" : "false";
                    if (element.spaceIfcId) elCheckbox.dataset.spaceid = element.spaceIfcId.toString();

                    const elIcon = document.createElement('span');
                    elIcon.className = "tree-node-icon";
                    elIcon.innerText = element.category === "furniture" ? "🪑" :
                                       element.category === "equipment" ? "🔌" :
                                       element.category === "structure" ? "🧱" : "📦";

                    const elLabel = document.createElement('span');
                    elLabel.className = "tree-node-label";
                    elLabel.innerText = `${element.name || `Element ${element.ifcId}`} [${element.ifcId}] (${element.type.replace("IFC", "")})`;

                    elRow.appendChild(elIndent);
                    elRow.appendChild(elCheckbox);
                    elRow.appendChild(elIcon);
                    elRow.appendChild(elLabel);

                    if (element.isContainedInSpace) {
                        const spaceBadge = document.createElement('span');
                        spaceBadge.className = "contained-badge";
                        spaceBadge.innerText = `📍 In: ${element.spaceName || 'Space ' + element.spaceIfcId}`;
                        spaceBadge.title = `Contained in ${element.spaceName || 'Space ' + element.spaceIfcId} (via IfcRelContained)`;
                        elRow.appendChild(spaceBadge);
                    }

                    elCheckbox.addEventListener('change', async (e) => {
                        e.stopPropagation();
                        await viewer.toggleExpressIdsVisibility([element.ifcId], elCheckbox.checked);
                    });

                    elRow.addEventListener('click', () => {
                        const baseNode = baseNodes.find(n => n.ifcId === element.ifcId);
                        if (baseNode) {
                            selectSpaceOrNode(baseNode, elRow);
                        }
                    });

                    groupChildren.appendChild(elRow);
                });

                storeyChildren.appendChild(groupRow);
                storeyChildren.appendChild(groupChildren);
            }

            buildingChildren.appendChild(storeyRow);
            buildingChildren.appendChild(storeyChildren);
        });

        siteChildren.appendChild(buildingRow);
        siteChildren.appendChild(buildingChildren);

        projectChildren.appendChild(siteRow);
        projectChildren.appendChild(siteChildren);

        treeDiv.appendChild(projectRow);
        treeDiv.appendChild(projectChildren);
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderHierarchyTree(searchInput.value);
        });
    }

    // --- Layers UI ---
    const layersListDiv = document.getElementById('layers-list') as HTMLDivElement;
    const btnAddLayer = document.getElementById('btn-add-layer') as HTMLButtonElement;
    const newLayerNameInput = document.getElementById('new-layer-name') as HTMLInputElement;

    const ilcNotEnoughLayers = document.getElementById('ilc-not-enough-layers') as HTMLDivElement;
    const ilcBuilderContainer = document.getElementById('ilc-builder-container') as HTMLDivElement;
    const ilcLayerCount = document.getElementById('ilc-layer-count') as HTMLElement;

    function updateIlcUI() {
        if (!ilcNotEnoughLayers || !ilcBuilderContainer) return;

        if (layers.length < 2) {
            ilcNotEnoughLayers.style.display = "block";
            if (ilcLayerCount) ilcLayerCount.innerText = layers.length.toString();
            ilcBuilderContainer.style.display = "none";
        } else {
            ilcNotEnoughLayers.style.display = "none";
            ilcBuilderContainer.style.display = "flex";
            updateIlcDropdowns();
        }
    }

    function renderLayers() {
        if (!layersListDiv) return;
        layersListDiv.innerHTML = "";

        if (layers.length === 0) {
            layersListDiv.innerHTML = `
                <div class="default-mode-banner">
                    <strong>📦 Default Single-Layer Mode Active</strong><br/>
                    No custom Thematic Layers defined. The model will export as a single <strong>Physical Layer</strong> containing all <code>IfcSpace</code> and opening cell spaces (+ dual network).<br/>
                    <em>To create separate thematic layers (e.g. "Spaces Layer", "Furniture Layer"), check elements in the hierarchy and click <strong>➕ Create Layer</strong> below.</em>
                </div>
            `;
            return;
        }

        layers.forEach(layer => {
            const div = document.createElement('div');
            div.className = "layer-item";

            const info = document.createElement('div');
            info.className = "layer-info";

            const title = document.createElement('span');
            title.className = "layer-title";
            title.innerText = layer.name;

            const sub = document.createElement('span');
            sub.className = "layer-sub";
            sub.innerText = `${layer.nodeIds.length} elements • Theme: ${layer.theme || 'Physical'}`;

            info.appendChild(title);
            info.appendChild(sub);
            div.appendChild(info);

            const ct = document.createElement('div');
            ct.className = "layer-actions";

            if (selectedNode) {
                if (layer.nodeIds.includes(selectedNode.id)) {
                    const inBadge = document.createElement('span');
                    inBadge.className = "badge-in-layer";
                    inBadge.innerText = "✓ In Layer";
                    ct.appendChild(inBadge);
                } else {
                    const btnAddSel = document.createElement('button');
                    btnAddSel.className = "btn-add-sel";
                    btnAddSel.innerText = "+ Add Selected";
                    btnAddSel.title = `Add ${selectedNode.name || selectedNode.id} to this layer`;

                    btnAddSel.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (!layer.nodeIds.includes(selectedNode.id)) {
                            layer.nodeIds.push(selectedNode.id);
                            renderLayers();
                            updateIlcUI();
                            updateSelectedSpaceCard();
                            statusDiv.innerText = `Added ${selectedNode.name || selectedNode.id} to layer "${layer.name}"`;
                        }
                    });
                    ct.appendChild(btnAddSel);
                }
            }

            const btnDelete = document.createElement('button');
            btnDelete.className = "btn-icon-delete";
            btnDelete.innerHTML = "🗑️";
            btnDelete.title = "Delete Layer";
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                layers = layers.filter(l => l.id !== layer.id);
                interLayerConnections = interLayerConnections.filter(ilc => ilc.fromLayerId !== layer.id && ilc.toLayerId !== layer.id);
                renderLayers();
                updateIlcUI();
                updateSelectedSpaceCard();
                renderIlcList();
                regenerateAndDrawNetwork();
                statusDiv.innerText = `Deleted layer "${layer.name}"`;
            });
            ct.appendChild(btnDelete);

            div.appendChild(ct);
            layersListDiv.appendChild(div);
        });
    }

    // Active multi-select preset categories: initial state has spaces & openings checked
    const activePresetCategories = new Set<string>(["spaces", "openings"]);

    function updateHierarchyHeaderCheckboxes() {
        // Group containers
        const groupContainers = treeDiv.querySelectorAll('.group-spaces-container, .group-openings-container, .group-elements-container');
        groupContainers.forEach(container => {
            const childCbs = container.querySelectorAll('.leaf-node .tree-node-checkbox') as NodeListOf<HTMLInputElement>;
            const headerCb = container.previousElementSibling?.querySelector('.tree-node-checkbox') as HTMLInputElement;
            if (headerCb && childCbs.length > 0) {
                const checkedCount = Array.from(childCbs).filter(cb => cb.checked).length;
                headerCb.checked = checkedCount > 0;
            }
        });

        // Storey rows
        const storeyRows = treeDiv.querySelectorAll('.tree-node-row:not(.leaf-node):not(.group-node)');
        storeyRows.forEach(stRow => {
            const container = stRow.nextElementSibling;
            if (container) {
                const childCbs = container.querySelectorAll('.leaf-node .tree-node-checkbox') as NodeListOf<HTMLInputElement>;
                const stCb = stRow.querySelector('.tree-node-checkbox') as HTMLInputElement;
                if (stCb && childCbs.length > 0) {
                    const checkedCount = Array.from(childCbs).filter(cb => cb.checked).length;
                    stCb.checked = checkedCount > 0;
                }
            }
        });
    }

    async function applyPresetSelectionToTree() {
        if (!spatialHierarchy) return;

        const checkSpaces = activePresetCategories.has("spaces");
        const checkOpenings = activePresetCategories.has("openings");
        const checkFurniture = activePresetCategories.has("furniture");
        const checkEquipment = activePresetCategories.has("equipment");
        const checkStructure = activePresetCategories.has("structure");
        const checkContained = activePresetCategories.has("contained");

        const allLeafCbs = treeDiv.querySelectorAll('.leaf-node .tree-node-checkbox') as NodeListOf<HTMLInputElement>;
        const visibleIds: number[] = [];
        const hiddenIds: number[] = [];

        allLeafCbs.forEach(cb => {
            const id = Number(cb.dataset.ifcid);
            const type = cb.dataset.type; // "space" | "opening" | "element"
            const cat = cb.dataset.category; // "furniture" | "equipment" | "structure" | "other"
            const isContained = cb.dataset.contained === "true";

            let shouldCheck = false;
            if (type === "space") {
                shouldCheck = checkSpaces;
            } else if (type === "opening") {
                shouldCheck = checkOpenings;
            } else if (type === "element") {
                if (cat === "furniture" && checkFurniture) shouldCheck = true;
                else if (cat === "equipment" && checkEquipment) shouldCheck = true;
                else if (cat === "structure" && checkStructure) shouldCheck = true;
                else if (isContained && checkContained) shouldCheck = true;
            }

            cb.checked = shouldCheck;
            if (shouldCheck) visibleIds.push(id);
            else hiddenIds.push(id);
        });

        updateHierarchyHeaderCheckboxes();

        await viewer.toggleExpressIdsVisibility(visibleIds, true);
        await viewer.toggleExpressIdsVisibility(hiddenIds, false);

        const activeLabels: string[] = [];
        if (checkSpaces) activeLabels.push("Spaces");
        if (checkFurniture) activeLabels.push("Furniture");
        if (checkContained) activeLabels.push("In Spaces");
        if (checkEquipment) activeLabels.push("Equipment");
        if (checkOpenings) activeLabels.push("Openings");
        if (checkStructure) activeLabels.push("Structure");

        statusDiv.innerText = activeLabels.length > 0 
            ? `Active Presets: ${activeLabels.join(" + ")} (${visibleIds.length} items checked)`
            : "No preset filters active (all unchecked)";
    }

    // Bind multi-select preset category buttons
    const presetButtons = document.querySelectorAll('.btn-preset[data-category]') as NodeListOf<HTMLButtonElement>;
    presetButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const cat = btn.dataset.category!;
            if (activePresetCategories.has(cat)) {
                activePresetCategories.delete(cat);
                btn.classList.remove('active');
            } else {
                activePresetCategories.add(cat);
                btn.classList.add('active');
            }
            await applyPresetSelectionToTree();
        });
    });

    const btnPresetAll = document.getElementById('btn-preset-all') as HTMLButtonElement;
    if (btnPresetAll) {
        btnPresetAll.addEventListener('click', async () => {
            activePresetCategories.add("spaces");
            activePresetCategories.add("openings");
            activePresetCategories.add("furniture");
            activePresetCategories.add("equipment");
            activePresetCategories.add("structure");
            activePresetCategories.add("contained");

            presetButtons.forEach(btn => btn.classList.add('active'));
            await applyPresetSelectionToTree();
        });
    }

    const btnPresetClear = document.getElementById('btn-preset-clear') as HTMLButtonElement;
    if (btnPresetClear) {
        btnPresetClear.addEventListener('click', async () => {
            activePresetCategories.clear();
            presetButtons.forEach(btn => btn.classList.remove('active'));
            await applyPresetSelectionToTree();
        });
    }

    if (btnAddLayer && newLayerNameInput) {
        btnAddLayer.addEventListener('click', async () => {
            const rawName = newLayerNameInput.value.trim();

            // Collect all checked express IDs from the hierarchy tree
            const checkedLeafCbs = treeDiv.querySelectorAll('.leaf-node .tree-node-checkbox:checked') as NodeListOf<HTMLInputElement>;
            const checkedIfcIds = new Set(Array.from(checkedLeafCbs).map(cb => Number(cb.dataset.ifcid)));

            const matchedNodeIds = baseNodes
                .filter(n => checkedIfcIds.has(n.ifcId))
                .map(n => n.id);

            if (matchedNodeIds.length === 0) {
                statusDiv.innerText = "Please check at least one space or element in the Hierarchy tree to include in this layer.";
                return;
            }

            const newLayerThemeSelect = document.getElementById('new-layer-theme') as HTMLSelectElement;
            const theme = newLayerThemeSelect ? newLayerThemeSelect.value : "Physical";

            // Intelligent default name based on active presets
            let defaultName = `Thematic Layer ${layers.length + 1}`;
            if (activePresetCategories.has("furniture") && activePresetCategories.size === 1) defaultName = "Furniture Layer";
            else if (activePresetCategories.has("spaces") && activePresetCategories.size === 1) defaultName = "Spaces Layer";
            else if (activePresetCategories.has("contained") && activePresetCategories.size === 1) defaultName = "Space Contained Layer";
            else if (activePresetCategories.has("openings") && activePresetCategories.size === 1) defaultName = "Openings Layer";
            else if (activePresetCategories.has("equipment") && activePresetCategories.size === 1) defaultName = "Equipment Layer";
            else if (activePresetCategories.has("furniture") && activePresetCategories.has("contained")) defaultName = "Interior Furniture Layer";

            const name = rawName || defaultName;

            const newLayerId = "layer-" + Date.now();
            layers.push({
                id: newLayerId,
                name: name,
                nodeIds: matchedNodeIds,
                theme: theme
            });
            newLayerNameInput.value = "";
            renderLayers();
            updateIlcUI();
            updateSelectedSpaceCard();
            statusDiv.innerText = `Layer "${name}" created with ${matchedNodeIds.length} elements (Theme: ${theme}).`;
        });
    }

    // --- SVO InterLayerConnection UI ---
    const ilcFromLayer = document.getElementById('ilc-from-layer') as HTMLSelectElement;
    const ilcToLayer = document.getElementById('ilc-to-layer') as HTMLSelectElement;
    const ilcFromNode = document.getElementById('ilc-from-node') as HTMLSelectElement;
    const ilcToNode = document.getElementById('ilc-to-node') as HTMLSelectElement;
    const btnAddIlc = document.getElementById('btn-add-ilc') as HTMLButtonElement;
    const ilcTopo = document.getElementById('ilc-topo') as HTMLSelectElement;
    const ilcComment = document.getElementById('ilc-comment') as HTMLInputElement;
    const ilcListDiv = document.getElementById('ilc-list') as HTMLDivElement;
    const ilcPreview = document.getElementById('ilc-svo-preview') as HTMLDivElement;
    const scopeRadios = document.querySelectorAll('input[name="ilc-scope"]') as NodeListOf<HTMLInputElement>;

    function getIlcScope(): "space" | "layer" {
        const checked = document.querySelector('input[name="ilc-scope"]:checked') as HTMLInputElement;
        return (checked?.value as "space" | "layer") || "space";
    }

    function updateSvoPreview() {
        if (!ilcPreview) return;
        const scope = getIlcScope();
        const fromLayer = layers.find(l => l.id === ilcFromLayer?.value);
        const toLayer = layers.find(l => l.id === ilcToLayer?.value);
        const topo = ilcTopo?.value || "Overlaps";

        if (!fromLayer || !toLayer) {
            ilcPreview.innerHTML = "💬 <em>Please create and select at least two thematic layers to connect.</em>";
            return;
        }

        if (fromLayer.id === toLayer.id) {
            ilcPreview.innerHTML = "⚠️ <span style='color: #ef4444;'>Subject Layer and Object Layer must be different!</span>";
            return;
        }

        if (scope === "space") {
            const fromNode = baseNodes.find(n => n.id === ilcFromNode?.value);
            const toNode = baseNodes.find(n => n.id === ilcToNode?.value);
            const subStr = fromNode 
                ? `<strong>${fromNode.name || fromNode.type} [${fromNode.ifcId}]</strong> (in <em>${fromLayer.name}</em>)`
                : "<strong style='color:#64748b;'>[No subject space selected]</strong>";
            const objStr = toNode 
                ? `<span class="obj">${toNode.name || toNode.type} [${toNode.ifcId}]</span> (in <em>${toLayer.name}</em>)`
                : "<span class='obj' style='color:#64748b;'>[No object space selected]</span>";
            ilcPreview.innerHTML = `💬 ${subStr} <em class="verb">${topo}</em> ${objStr}`;
        } else {
            ilcPreview.innerHTML = `💬 <strong>${fromLayer.name}</strong> <em class="verb">${topo}</em> <span class="obj">${toLayer.name}</span> <em>(Whole-layer relationship)</em>`;
        }
    }

    scopeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const scope = getIlcScope();
            const subWrap = document.getElementById('ilc-subject-node-wrap');
            const objWrap = document.getElementById('ilc-object-node-wrap');
            if (subWrap && objWrap) {
                subWrap.style.display = scope === "layer" ? "none" : "block";
                objWrap.style.display = scope === "layer" ? "none" : "block";
            }
            updateSvoPreview();
        });
    });

    function updateIlcDropdowns() {
        if (!ilcFromLayer || !ilcToLayer) return;

        const prevFromLayer = ilcFromLayer.value;
        const prevToLayer = ilcToLayer.value;

        ilcFromLayer.innerHTML = "";
        ilcToLayer.innerHTML = "";

        layers.forEach((layer) => {
            const opt1 = document.createElement('option');
            opt1.value = layer.id;
            opt1.innerText = `${layer.name} (${layer.theme || 'Physical'})`;
            ilcFromLayer.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = layer.id;
            opt2.innerText = `${layer.name} (${layer.theme || 'Physical'})`;
            ilcToLayer.appendChild(opt2);
        });

        if (layers.some(l => l.id === prevFromLayer)) {
            ilcFromLayer.value = prevFromLayer;
        } else if (layers.length > 0) {
            ilcFromLayer.value = layers[0].id;
        }

        if (layers.some(l => l.id === prevToLayer) && prevToLayer !== ilcFromLayer.value) {
            ilcToLayer.value = prevToLayer;
        } else if (layers.length > 1) {
            ilcToLayer.value = layers[1].id;
        } else if (layers.length > 0) {
            ilcToLayer.value = layers[0].id;
        }

        updateNodeDropdown(ilcFromLayer, ilcFromNode);
        updateNodeDropdown(ilcToLayer, ilcToNode);
        updateSvoPreview();
    }

    function updateNodeDropdown(layerSelect: HTMLSelectElement, nodeSelect: HTMLSelectElement) {
        if (!layerSelect || !nodeSelect) return;
        const layerId = layerSelect.value;
        const layer = layers.find(l => l.id === layerId);

        nodeSelect.innerHTML = "";

        if (layer) {
            let layerNodes = baseNodes.filter(n => layer.nodeIds.includes(n.id));
            if (layerNodes.length === 0) {
                // If layer has no nodes yet, allow selecting from all nodes
                layerNodes = baseNodes;
            }
            layerNodes.forEach(n => {
                const opt = document.createElement('option');
                opt.value = n.id;
                opt.innerText = `${n.name || n.type} [${n.ifcId}]`;
                nodeSelect.appendChild(opt);
            });
        }
        updateSvoPreview();
    }

    if (ilcFromLayer) {
        ilcFromLayer.addEventListener('change', () => {
            updateNodeDropdown(ilcFromLayer, ilcFromNode);
            updateSvoPreview();
        });
    }
    if (ilcToLayer) {
        ilcToLayer.addEventListener('change', () => {
            updateNodeDropdown(ilcToLayer, ilcToNode);
            updateSvoPreview();
        });
    }
    if (ilcFromNode) {
        ilcFromNode.addEventListener('change', updateSvoPreview);
    }
    if (ilcToNode) {
        ilcToNode.addEventListener('change', updateSvoPreview);
    }
    if (ilcTopo) {
        ilcTopo.addEventListener('change', updateSvoPreview);
    }

    if (btnAddIlc) {
        btnAddIlc.addEventListener('click', () => {
            const scope = getIlcScope();
            const fromLayerId = ilcFromLayer.value;
            const toLayerId = ilcToLayer.value;
            const fromNodeId = ilcFromNode?.value;
            const toNodeId = ilcToNode?.value;
            const topo = ilcTopo.value;
            const comment = ilcComment.value.trim();

            if (!fromLayerId || !toLayerId) {
                statusDiv.innerText = "Please select both Subject and Object layers.";
                return;
            }

            if (fromLayerId === toLayerId) {
                statusDiv.innerText = "Subject Layer and Object Layer must be DIFFERENT!";
                return;
            }

            if (scope === "space" && (!fromNodeId || !toNodeId)) {
                statusDiv.innerText = "Please select both Subject and Object spaces/cells.";
                return;
            }

            const newIlc: InterLayerConnection = {
                id: "ilc-" + Date.now(),
                fromNodeId: scope === "space" ? fromNodeId : undefined,
                toNodeId: scope === "space" ? toNodeId : undefined,
                fromLayerId,
                toLayerId,
                typeOfTopoExpression: topo,
                comment: comment || undefined,
                level: scope
            };

            interLayerConnections.push(newIlc);
            ilcComment.value = "";
            renderIlcList();
            regenerateAndDrawNetwork();
            updateSvoPreview();
            statusDiv.innerText = `Inter-layer SVO connection added: (${topo}). Export is ready!`;
        });
    }

    function renderIlcList() {
        if (!ilcListDiv) return;
        ilcListDiv.innerHTML = "";

        if (interLayerConnections.length === 0) {
            ilcListDiv.innerHTML = `<div class="empty-message">No connections created yet.</div>`;
            return;
        }

        interLayerConnections.forEach(ilc => {
            const fromLayer = layers.find(l => l.id === ilc.fromLayerId);
            const toLayer = layers.find(l => l.id === ilc.toLayerId);
            const fromNode = baseNodes.find(n => n.id === ilc.fromNodeId);
            const toNode = baseNodes.find(n => n.id === ilc.toNodeId);

            const div = document.createElement('div');
            div.className = "ilc-item";

            const info = document.createElement('div');
            info.className = "ilc-info";

            const title = document.createElement('span');
            title.className = "ilc-title";

            const sub = document.createElement('span');
            sub.className = "ilc-sub";

            if (ilc.level === "layer" || (!fromNode && !toNode)) {
                title.innerHTML = `<strong>${fromLayer ? fromLayer.name : 'Layer 1'}</strong> ➔ <span style="color:#f59e0b;font-weight:700;">${ilc.typeOfTopoExpression}</span> ➔ <span style="color:#ec4899;font-weight:600;">${toLayer ? toLayer.name : 'Layer 2'}</span>`;
                sub.innerText = `Whole-layer relationship${ilc.comment ? ` • "${ilc.comment}"` : ''}`;
            } else {
                title.innerHTML = `<strong>${fromNode ? fromNode.name || fromNode.type : 'Space'}</strong> ➔ <span style="color:#f59e0b;font-weight:700;">${ilc.typeOfTopoExpression}</span> ➔ <span style="color:#ec4899;font-weight:600;">${toNode ? toNode.name || toNode.type : 'Space'}</span>`;
                sub.innerText = `${fromLayer ? fromLayer.name : 'L1'} ↔ ${toLayer ? toLayer.name : 'L2'}${ilc.comment ? ` • "${ilc.comment}"` : ''}`;
            }

            info.appendChild(title);
            info.appendChild(sub);
            div.appendChild(info);

            const btnDel = document.createElement('button');
            btnDel.className = "btn-icon-delete";
            btnDel.innerHTML = "🗑️";
            btnDel.title = "Delete connection";
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                interLayerConnections = interLayerConnections.filter(item => item.id !== ilc.id);
                renderIlcList();
                regenerateAndDrawNetwork();
                updateSvoPreview();
            });

            div.appendChild(btnDel);
            ilcListDiv.appendChild(div);
        });
    }
}

init();
