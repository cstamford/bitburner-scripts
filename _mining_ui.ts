import {get_overview_box_rect, get_terminal_rect} from "@/_layout";
import {get_time, money} from "@/_util";
import {CoordinatorMetrics, OperationRegion, OpType, RegionState} from "@/_mining";
import {Analysis} from "@/_mining_analysis";

export function create_ui() {
    const terminalRect = get_terminal_rect();
    const overviewRect = get_overview_box_rect();

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = `${terminalRect.x}px`;
    container.style.width = `${overviewRect.x - terminalRect.x}px`;
    container.style.background = "rgba(20, 20, 20, 0.95)";
    container.style.border = "1px solid rgba(255, 255, 255, 0.15)";
    container.style.boxShadow = "0px 0px 12px rgba(0, 0, 0, 0.5)";
    container.style.borderRadius = "4px";
    container.style.padding = "10px";

    document.getElementById("root")!.appendChild(container);
    return container;
}

export function create_ui_metrics(container: HTMLDivElement, targets: string[]) {
    const table = document.createElement("table");
    table.id = 'metricsTable';
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "9px";
    table.style.color = "#FFF";
    table.style.fontFamily = "'Orbitron', monospace";
    table.style.letterSpacing = "1px";

    const headerRow = table.insertRow();

    const headers = [
        "",
        "Profit",
        "Active",
        "Total",
        "Realised",
        "Delayed",
        "Cancelled",
        "Money %",
        "Sec Failures",
        "OOM Jobs",
        "OOM Batches"
    ];

    headers.forEach((headerText, index) => {
        let headerCell = document.createElement("th");
        headerCell.textContent = headerText;
        if (index == 0) {
            headerCell.style.visibility = "hidden";
        } else {
            headerCell.style.padding = "2px";
        }
        headerRow.appendChild(headerCell);
    });

    targets.forEach((target, index) => {
        let row = table.insertRow();
        row.id = `metricsRow-${index}`;
        for (let i = 0; i < headers.length; i++) {
            let cell = row.insertCell();
            cell.style.padding = "2px";
            cell.style.textAlign = "center";

            if (i != targets.length - 1) {
                cell.style.borderRight = "1px solid rgba(255, 255, 255, 0.05)";
            }

            if (i == 0) {
                cell.textContent = target;
                cell.style.fontWeight = "bold";
                cell.style.color = "magenta";
            }
        }
    });

    container.appendChild(table);
}

export function update_ui(regions: OperationRegion[], container: HTMLDivElement, divs: Map<string, HTMLDivElement>) {
    const time = get_time();
    const regionIdsInUse = new Set(regions.map(r => `group-${r.group}-order-${r.groupOrder}`));

    divs.forEach((div, id) => {
        if (!regionIdsInUse.has(id)) {
            div.remove();
            divs.delete(id);
        }
    });

    const minTimeWindow = 1000;
    const maxTimeWindow = 30000;

    // zoomed out:
    const timeWindow = Math.max(minTimeWindow, Math.min(maxTimeWindow,
        2 * (Math.max(...regions.map(x => x.end)) - Math.min(...regions.map(x => x.start)))));

    // zoomed in:
    //const timeWindow = Math.max(minTimeWindow, Math.min(maxTimeWindow,
    //    Math.max(...regions.map(x => x.end - x.start))));

    //super zoomed in:
    //const timeWindow = Math.max(minTimeWindow, Math.min(maxTimeWindow,
    //    Math.min(...regions.map(x => x.end - x.start))));

    const minBoxHeight = 8;
    const maxBoxHeight = 24;
    const boxHeight =  maxBoxHeight - (maxBoxHeight - minBoxHeight) *
        ((timeWindow - minTimeWindow) / (maxTimeWindow - minTimeWindow));

    const containerWidth = container.offsetWidth;
    const scale = containerWidth / timeWindow;

    const maxOrder = Math.max(...regions.map(x => x.groupOrder));
    const minOrder = Math.min(...regions.map(x => x.groupOrder));

    let drawnNum = 0;
    let nextNeedsStabilization = false;

    regions.forEach((region, i) => {
        if (region.state == RegionState.Stabilization) {
            nextNeedsStabilization = true;
            return;
        }

        const spawnOffset = time - region.jobCreated;
        const startOffset = time - region.start;
        const endOffset = time - region.end;
        const despawnOffset = time - region.jobCreated;

        const spawn = Math.max(0, Math.round((containerWidth/2) - (spawnOffset * scale)));
        const start = Math.max(0, Math.round((containerWidth/2) - (startOffset * scale)));
        const end = Math.min(containerWidth, (containerWidth/2) - (endOffset * scale));
        const despawn = Math.max(0, Math.round((containerWidth/2) - (despawnOffset * scale)));

        const spawnWidth = start - spawn;
        const regionWidth = end - start;
        const despawnWidth = Math.max(0, despawn - end);

        const regionId = `group-${region.group}-order-${region.groupOrder}`;

        let regionBox = divs.get(regionId);
        let spawnBox : HTMLDivElement;
        let despawnBox : HTMLDivElement;
        let groupSquare : HTMLDivElement;

        if (regionBox) {
            spawnBox = regionBox.querySelector("div.spawnBox") as HTMLDivElement;
            despawnBox = regionBox.querySelector("div.despawnBox") as HTMLDivElement;
            groupSquare = regionBox.querySelector("div.groupSquare") as HTMLDivElement;
        } else {
            regionBox = document.createElement("div");
            regionBox.className = regionId;
            regionBox.style.position = "absolute";
            regionBox.style.height = `${boxHeight}px`;
            regionBox.style.backgroundImage = "linear-gradient(to left, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0))";
            regionBox.style.border = "1px solid rgba(255, 255, 255, 0.1)";
            regionBox.style.margin = "2px 0";
            regionBox.style.boxShadow = "inset 0 0 8px rgba(0, 0, 0, 0.3)";
            regionBox.style.color = "#1e1e1e";

            spawnBox = document.createElement("div");
            spawnBox.className = "spawnBox";
            spawnBox.style.position = "absolute";
            spawnBox.style.height = `${boxHeight}px`;
            spawnBox.style.backgroundColor = "rgba(0, 255, 0, 0.3)";
            regionBox.appendChild(spawnBox);

            despawnBox = document.createElement("div");
            despawnBox.className = "despawnBox";
            despawnBox.style.position = "absolute";
            despawnBox.style.height = `${boxHeight}px`;
            despawnBox.style.backgroundColor = "rgba(255, 0, 0, 0.3)";
            regionBox.appendChild(despawnBox);

            groupSquare = document.createElement("div");
            groupSquare.className = "groupSquare";
            groupSquare.style.width = `${Math.round(boxHeight * 0.66)}px`;
            groupSquare.style.height = `${Math.round(boxHeight * 0.66)}px`;
            groupSquare.style.backgroundColor = `hsla(${(region.group * 137) % 360}, 70%, 50%, 1.0)`;
            groupSquare.style.position = "absolute";
            groupSquare.style.left = "100%";
            groupSquare.style.top = "50%";
            groupSquare.style.transform = "translateY(-50%)";
            groupSquare.style.font = `bold ${Math.round(boxHeight * 0.66)}px monospace`;
            groupSquare.style.textAlign = "center";
            groupSquare.textContent = `${region.groupOrder - minOrder}`;
            regionBox.appendChild(groupSquare);

            container.appendChild(regionBox);
            divs.set(regionId, regionBox);
        }

        regionBox.style.left = `${start}px`;
        regionBox.style.width = `${regionWidth}px`;
        regionBox.style.top = `${drawnNum*boxHeight + drawnNum*2}px`;

        spawnBox.style.marginLeft = `${-spawnWidth}px`;
        spawnBox.style.width = `${spawnWidth}px`;

        despawnBox.style.left = `${regionWidth}px`;
        despawnBox.style.width = `${despawnWidth}px`;

        groupSquare.style.marginLeft = `${boxHeight*0.66}px`;

        const enableOutOfOrderViz: boolean = true;

        const inOrderBack = !enableOutOfOrderViz || i == 0 ||
            regions[i-1].state == RegionState.Stabilization ||
            (region.groupOrder == minOrder && regions[i-1].group == region.group - 1) ||
            (region.groupOrder != minOrder && regions[i-1].groupOrder == region.groupOrder - 1);

        const inOrderFront = !enableOutOfOrderViz || i == regions.length - 1 ||
            regions[i+1].state == RegionState.Stabilization ||
            (region.groupOrder == maxOrder && regions[i+1].group == region.group + 1) ||
            (region.groupOrder != maxOrder && regions[i+1].groupOrder == region.groupOrder + 1);

        if (!inOrderBack || !inOrderFront) {
            regionBox.style.backgroundColor = "red";
        } else if (region.type == OpType.Weaken) {
            regionBox.style.backgroundColor = "#263b59";
        } else if (region.type == OpType.Grow) {
            regionBox.style.backgroundColor = "#004d00";
        } else if (region.type == OpType.Hack) {
            regionBox.style.backgroundColor = "#522252";
        } else {
            regionBox.style.backgroundColor = "transparent";
        }

        if (region.state == RegionState.Delayed) {
            regionBox.style.border = "2px inset";
            regionBox.style.borderColor = "#ffcc00";
        } else if (region.state == RegionState.Cancelled) {
            regionBox.style.border = "2px inset";
            regionBox.style.borderColor = "#ff0900";
        }

        if (start >= containerWidth || end <= 0) {
            regionBox.style.visibility = "hidden";
        }
        else {
            regionBox.style.visibility = "visible";
        }

        if (time > region.end) {
            regionBox.style.opacity = '0.5';
        } else {
            regionBox.style.opacity = '1.0';
        }

        ++drawnNum;
    });

    let timeLine = document.getElementById("timeLine");

    if (timeLine) {
        container.removeChild(timeLine);
    } else {
        timeLine = document.createElement("div");
        timeLine.id = "timeLine";
        timeLine.style.position = "absolute";
        timeLine.style.left = `${container.offsetWidth/2}px`;
        timeLine.style.width = "1px";
        timeLine.style.top = "0px";
        timeLine.style.height = `${container.offsetHeight}px`;
        timeLine.style.backgroundColor = "white";
        timeLine.style.boxShadow = "0 0 8px white";
    }

    container.appendChild(timeLine);
}

export function update_metrics_ui(workerIdx: number, startTime: number, analysis: Analysis, metrics: CoordinatorMetrics) {
    const totalTime = get_time() - startTime;
    const totalMoney = metrics.realisedBatches * analysis.predictedYield;
    const moneyPerMsec = totalMoney / totalTime;

    const row = document.getElementById(`metricsRow-${workerIdx}`) as HTMLTableRowElement;
    if (row) {
        row.cells[1].textContent = `${money(moneyPerMsec*1000)}/sec`;
        row.cells[2].textContent = `${metrics.activeJobs}`;
        row.cells[3].textContent = `${metrics.totalJobs}`;
        row.cells[4].textContent = `${metrics.realisedBatches}`;
        row.cells[5].textContent = `${metrics.delayedBatches}`;
        row.cells[6].textContent = `${metrics.cancelledBatches}`;
        row.cells[7].textContent = `${(metrics.moneyPercent * 100).toFixed(2)}`;
        row.cells[8].textContent = `${metrics.securityFailures}`;
        row.cells[9].textContent = `${metrics.oomJobs}`;
        row.cells[10].textContent = `${metrics.oomBatches}`;
    }

    let metricsTable = document.getElementById('metricsTable')!;
    metricsTable.parentElement?.appendChild(metricsTable);
}
