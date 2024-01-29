import {NS} from "@ns";
import {get_all_controllable_hosts, get_all_hosts, get_time} from "@/_util";
import {
    SchedulerTargetData,
    SocketCommand,
    SocketCommandBudgets, SocketCommandServers,
    SocketCommandStart,
    SocketCommandType,
    SocketData,
    SocketSchedulerType,
    SocketTargetData
} from "@/_shared";
import {make_empty_target_data, SchedulerCommandBudgets, SchedulerCommandType} from "@/_mining";

export async function main(ns: NS) {
    let messages: string[] = [];
    let ws = web_connect(ns, messages);

    let targetData: SchedulerTargetData[] = [];

    let schedulerType = SocketSchedulerType.None;
    let schedulerPid = -1;
    let schedulerBasePort = -1;

    let serverCoreTarget = 0;

    while (true) {
        if (schedulerPid == -1) {
            targetData = [];
        } else {
            const schedulerPortRead = ns.getPortHandle(schedulerBasePort + 1);
            while (!schedulerPortRead.empty()) {
                targetData = JSON.parse(schedulerPortRead.read() as string) as SchedulerTargetData[];
            }
        }

        while (messages.length > 0) {
            const command = JSON.parse(messages.shift()!) as SocketCommand;

            if (command.type == SocketCommandType.Start) {
                const start = command as SocketCommandStart;

                if (schedulerType != start.schedulerType && schedulerPid != -1) {
                    ns.kill(schedulerPid);
                    schedulerPid = -1;
                    schedulerBasePort = -1;
                }

                schedulerType = start.schedulerType;

                if (schedulerType != SocketSchedulerType.None) {
                    let script = "";

                    if (start.schedulerType == SocketSchedulerType.Batcher) {
                        script = "/mining-scheduler.js";
                    } else if (start.schedulerType == SocketSchedulerType.Drain) {
                        script = "/mining-drain.js";
                    }

                    schedulerPid = ns.run(script);
                    schedulerBasePort = schedulerPid * 6;
                }
            } else if (command.type == SocketCommandType.Budget) {
                const socketBudgets = command as SocketCommandBudgets;

                if (schedulerPid != -1) {
                    const schedulerPortWrite = ns.getPortHandle(schedulerBasePort);
                    const schedulerBudgets: SchedulerCommandBudgets = {
                        type: SchedulerCommandType.Budget,
                        budgets: socketBudgets.budgets
                    };
                    schedulerPortWrite.write(JSON.stringify(schedulerBudgets));
                }
            } else if (command.type == SocketCommandType.ConnectTarget) {
                // TODO: After singularity, connect
            } else if (command.type == SocketCommandType.SetShares) {
                // TODO
            } else if (command.type == SocketCommandType.SetServers) {
                const socketServers = command as SocketCommandServers;
                serverCoreTarget = socketServers.ram;
            }
        }

        if (ws.readyState == WebSocket.OPEN) {
            const hosts = get_all_controllable_hosts(ns);
            const totalMaxRam = hosts.reduce((total, host) => total + ns.getServerMaxRam(host), 0);
            const totalUsedRam = hosts.reduce((total, host) => total + ns.getServerUsedRam(host), 0);
            const ramUsagePercentage = totalMaxRam > 0 ? (totalUsedRam / totalMaxRam) * 100 : 0;

            const player = ns.getPlayer();
            const bn = ns.getBitNodeMultipliers();

            const data: SocketData = {
                type: schedulerType,
                shares: 0,
                servers: serverCoreTarget,
                time: get_time(),
                money: ns.getPlayer().money,
                ram: ramUsagePercentage,
                skills: {
                    hack: player.skills.hacking,
                    hackProgress: progress(ns, player.exp.hacking, player.mults.hacking * bn.HackingLevelMultiplier),
                    martial: Math.min(player.skills.agility, player.skills.defense, player.skills.dexterity, player.skills.strength),
                    martialProgress: Math.min(
                        progress(ns, player.exp.agility, player.mults.agility * bn.AgilityLevelMultiplier),
                        progress(ns, player.exp.defense, player.mults.defense * bn.DefenseLevelMultiplier),
                        progress(ns, player.exp.dexterity, player.mults.dexterity * bn.DexterityLevelMultiplier),
                        progress(ns, player.exp.strength, player.mults.strength * bn.StrengthLevelMultiplier)),
                    cha: player.skills.charisma,
                    chaProgress: progress(ns, player.exp.charisma, player.mults.charisma * bn.CharismaLevelMultiplier),
                    int: player.skills.intelligence,
                    intProgress: progress(ns, player.exp.intelligence, 1)
                },
                targets: make_socket_target_data(ns, get_all_hosts(ns, false), targetData)
            };

            ws.send(JSON.stringify(data));
        }

        if (serverCoreTarget > 0) {
            ns.run("/controller-servers.js", 1, serverCoreTarget);
        }

        await ns.sleep(1000);
    }
}

function web_connect(ns: NS, messages: string[]) {
    const ws = new WebSocket('ws://localhost:27152');

    ws.onclose = () => {
        setTimeout(() => web_connect(ns, messages), 100);
    };

    ws.onerror = (error) => {
        ws.close();
    };

    ws.onmessage = async (event) => {
        messages.push(await event.data.text());
    };

    return ws;
}

function make_socket_target_data(ns: NS, servers: string[], targetData: SchedulerTargetData[]): SocketTargetData[] {
    const targetDataMap = new Map(targetData.map(x => [x.target, x]));
    return servers.map(x => ({
        backdoored: ns.getServer(x).backdoorInstalled ?? false,
        backdoorable: x != "home" && !x.startsWith("kat-") && ns.getServerRequiredHackingLevel(x) <= ns.getHackingLevel(),
        hackable:  ns.getServerMaxMoney(x) > 0,
        faction: ["CSEC", "avmnite-02h", "I.I.I.I", "run4theh111z"].includes(x),
        ...(targetDataMap.get(x) ?? make_empty_target_data(ns, x))
    }));
}

function progress(ns: NS, exp: number, multi: number): number {
    const currentSkill = ns.formulas.skills.calculateSkill(exp, multi);
    const curLevelExp = ns.formulas.skills.calculateExp(currentSkill, multi)
    const nextLevelExp = ns.formulas.skills.calculateExp(currentSkill + 1, multi);
    return (exp - curLevelExp) / (nextLevelExp - curLevelExp);
}
