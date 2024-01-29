import {NS} from "@ns";
import {get_time_precise} from "@/_util";

export async function main(ns: NS) {
    const time = get_time_precise();
    const target = ns.args[0] as string;
    const end = ns.args.length >= 2 ? (ns.args[1] as number) : 0;
    const duration = ns.args.length >= 3 ? (ns.args[2] as number) : 0;
    const delay = end - duration - time;

    if (ns.args.length <= 3) {
        await ns.grow(target as string, {additionalMsec: Math.max(0, delay)});
        return;
    }

    const id = ns.args[3] as number;
    const finishPort = ns.getPortHandle(ns.args[4] as number);
    const finishBarrierPort = ns.getPortHandle(ns.args[5] as number);
    const skip = ns.args[6] as boolean;

    let grow: any;

    if (skip) {
        grow = ns.asleep(end - time);
    } else {
        grow = ns.grow(target, {additionalMsec: Math.max(0, delay)});
    }

    await grow;

    return ns.atExit(async () => {
        finishPort.write(id);
        await finishBarrierPort.nextWrite();
    });
}
