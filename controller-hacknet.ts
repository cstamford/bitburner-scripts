import {NS} from '@ns';

export async function main(ns: NS): Promise<void> {
    while (true) {
        if (ns.hacknet.getPurchaseNodeCost() <= 512_000 && ns.hacknet.purchaseNode() != -1) {
            continue;
        }

        const numNodes = ns.hacknet.numNodes();
        const mults = ns.getHacknetMultipliers();

        let bestUpgrade = {
            type: '',
            idx: -1,
            price: Infinity,
            pricePer: Infinity
        };

        for (let i = 0; i < numNodes; i++) {
            const nodeStats = ns.hacknet.getNodeStats(i);

            const levelCost = ns.formulas.hacknetNodes.levelUpgradeCost(nodeStats.level, 1, mults.levelCost);
            const levelProd = ns.formulas.hacknetNodes.moneyGainRate(
                nodeStats.level + 1, nodeStats.ram, nodeStats.cores, mults.production) - nodeStats.production;
            const levelPricePer = levelCost / levelProd;

            const ramCost = ns.formulas.hacknetNodes.ramUpgradeCost(nodeStats.ram, 1, mults.ramCost);
            const ramProd = ns.formulas.hacknetNodes.moneyGainRate(
                nodeStats.level, nodeStats.ram * 2, nodeStats.cores, mults.production) - nodeStats.production;
            const ramPricePer = ramCost / ramProd;

            const coreCost = ns.formulas.hacknetNodes.coreUpgradeCost(nodeStats.cores, 1, mults.coreCost);
            const coreProd = ns.formulas.hacknetNodes.moneyGainRate(
                nodeStats.level, nodeStats.ram, nodeStats.cores + 1, mults.production) - nodeStats.production;
            const corePricePer = coreCost / coreProd;

            if (levelPricePer < bestUpgrade.pricePer) {
                bestUpgrade = { type: 'level', idx: i, price: levelCost, pricePer: levelPricePer };
            }

            if (ramPricePer < bestUpgrade.pricePer) {
                bestUpgrade = { type: 'ram', idx: i, price: ramCost, pricePer: ramPricePer };
            }

            if (corePricePer < bestUpgrade.pricePer) {
                bestUpgrade = { type: 'core', idx: i, price: coreCost, pricePer: corePricePer };
            }
        }

        if (bestUpgrade.idx != -1 && bestUpgrade.pricePer <= 10000 && ns.getServerMoneyAvailable("home") >= bestUpgrade.price) {
            switch (bestUpgrade.type) {
                case 'level':
                    ns.hacknet.upgradeLevel(bestUpgrade.idx, 1);
                    break;
                case 'ram':
                    ns.hacknet.upgradeRam(bestUpgrade.idx, 1);
                    break;
                case 'core':
                    ns.hacknet.upgradeCore(bestUpgrade.idx, 1);
                    break;
            }
        }

        await ns.sleep(100);
    }
}
