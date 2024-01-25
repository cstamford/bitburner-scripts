import {NodeStats, NS} from '@ns';

export async function main(ns: NS): Promise<void> {
    while (true) {
        let playerMoney = ns.getPlayer().money;
        let numNodes = ns.hacknet.numNodes();

        if (numNodes < 14 && ns.hacknet.purchaseNode() != -1) {
            continue;
        }

        const node = [...Array(numNodes).keys()]
            .map((x, i) => ({idx: i, data: ns.hacknet.getNodeStats(x)}))
            .sort((a, b) => a.data.production - b.data.production)
            .at(0);

        if (node) {
            if (node.data.ram == 1) {
                level(ns, node.idx, node.data, 64) ||
                cores(ns, node.idx, node.data, 1) ||
                ram(ns, node.idx, node.data, 2);
            } else if (node.data.ram == 2) {
                level(ns, node.idx, node.data, 72) ||
                cores(ns, node.idx, node.data, 1) ||
                ram(ns, node.idx, node.data, 4);
            } else if (node.data.ram == 4) {
                level(ns, node.idx, node.data, 80) ||
                cores(ns, node.idx, node.data, 2) ||
                ram(ns, node.idx, node.data, 8);
            } else if (node.data.ram == 8) {
                level(ns, node.idx, node.data, 88) ||
                cores(ns, node.idx, node.data, 2) ||
                ram(ns, node.idx, node.data, 16);
            } else if (node.data.ram == 16) {
                level(ns, node.idx, node.data, 96) ||
                cores(ns, node.idx, node.data, 2) ||
                ram(ns, node.idx, node.data, 32);
            } else if (node.data.ram == 32) {
                level(ns, node.idx, node.data, 104) ||
                cores(ns, node.idx, node.data, 3) ||
                ram(ns, node.idx, node.data, 64);
            } else {
                level(ns, node.idx, node.data, 128) ||
                cores(ns, node.idx, node.data, 4);
            }
        }

        await ns.sleep(100);
    }
}

function level(ns: NS, idx: number, node: NodeStats, target: number) {
    if (node.level < target && ns.getPlayer().money >= ns.hacknet.getLevelUpgradeCost(idx, 1)) {
        ns.hacknet.upgradeLevel(idx, 1);
        return true;
    }
    return node.level < target;
}

function ram(ns: NS, idx: number, node: NodeStats, target: number) {
    if (node.ram < target && ns.getPlayer().money >= ns.hacknet.getRamUpgradeCost(idx, 1)) {
        ns.hacknet.upgradeRam(idx, 1);
        return true;
    }
    return node.ram < target;
}

function cores(ns: NS, idx: number, node: NodeStats, target: number) {
    if (node.cores < target && ns.getPlayer().money >= ns.hacknet.getCoreUpgradeCost(idx, 1)) {
        ns.hacknet.upgradeCore(idx, 1);
        return true;
    }
    return node.cores < target;
}
