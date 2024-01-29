import {NS} from "@ns";
import {
    dispatch,
    get_durations,
    get_script_mem_cost,
    make_empty_target_data,
    refresh_targets,
    refresh_workers, SchedulerCommand, SchedulerCommandBudgets, SchedulerCommandType,
    transfer_scripts
} from "@/_mining";
import {
    OpType,
    SchedulerTargetData
} from "@/_shared";
import {get_time} from "@/_util";

export async function main(ns: NS) {
    ns.disableLog("ALL");

    const basePortId = ns.pid * 6;
    const controllerReadPort = ns.getPortHandle(basePortId);
    const controllerWritePort = ns.getPortHandle(basePortId + 1);

    controllerReadPort.clear();
    controllerWritePort.clear();

    let nextControllerUpdate = 0;

    const hackCost = get_script_mem_cost(ns, OpType.Hack)
    const outstandingJobs: number[] = [];
    const outstandingJobsToTarget: Map<Number, SchedulerTargetData> = new Map();
    const targets: SchedulerTargetData[] = [];

    while (true) {
        const workers = refresh_workers(ns);

        for (const worker of workers) {
            transfer_scripts(ns, worker.host);
        }

        for (const targetHost of refresh_targets(ns)) {
            let target = targets.find(x => x.target == targetHost);

            if (!target) {
                target = make_empty_target_data(ns, targetHost);
                targets.push(target);
            }

            target.analysisDurations = get_durations(ns, target.target);
            target.metrics.money = ns.getServerMoneyAvailable(target.target) / ns.getServerMaxMoney(target.target);
            target.metrics.security = ns.getServerSecurityLevel(target.target) - ns.getServerMinSecurityLevel(target.target);
        }

        while (!controllerReadPort.empty()) {
            const command = JSON.parse(controllerReadPort.read() as string) as SchedulerCommand;

            if (command.type == SchedulerCommandType.Budget) {
                const budgets = command as SchedulerCommandBudgets;
                for (const budget of budgets.budgets) {
                    targets.find(x => x.target == budget.target)!.budget = budget.budget;
                }
            }
        }

        const time = get_time();

        if (time >= nextControllerUpdate) {
            controllerWritePort.write(JSON.stringify(targets));
            nextControllerUpdate = time + 256;
        }

        if (outstandingJobs.length == 0) {
            for (const target of targets) {
                if (target.metrics.money < 0.001) {
                    target.budget = 0;
                    break;
                }

                const normalizedBudget = target.budget / 100;

                if (normalizedBudget == 0) {
                    continue;
                }

                for (const worker of workers) {
                    const memTarget = normalizedBudget * worker.maxMem;
                    const threads = Math.floor(Math.min(memTarget, worker.mem) / hackCost);

                    if (threads > 0) {
                        const pid = dispatch(ns, OpType.Hack, threads, worker.host, target.target);
                        outstandingJobsToTarget.set(pid, target);
                        outstandingJobs.push(pid);
                        ++target.metrics.activeJobs;
                        ++target.metrics.totalJobs;
                        worker.mem -= threads * hackCost;
                    }
                }
            }

        } else {
            for (let i = 0; i < outstandingJobs.length; ++i) {
                const pid = outstandingJobs[i];
                if (!ns.isRunning(pid)) {
                    const target = outstandingJobsToTarget.get(pid)!;
                    outstandingJobsToTarget.delete(pid);
                    outstandingJobs.splice(i--, 1);
                    --target.metrics.activeJobs;
                }
            }
        }

        await ns.sleep(0);
    }
}
