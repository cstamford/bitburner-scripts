import {NS} from "@ns";
import {get_time} from "@/_util";
import {write_message_finished, write_message_started} from "@/_mining";

export async function main(ns: NS) {
    const time = get_time();
    const target = ns.args[0] as string;
    const end = ns.args.length >= 2 ? (ns.args[1] as number) : 0;
    const duration = ns.args.length >= 3 ? (ns.args[2] as number) : 0;
    const delay = end - duration - time;

    if (ns.args.length <= 3) {
        await ns.hack(target as string, {additionalMsec: Math.max(0, delay)});
        return;
    }

    const id = ns.args[3] as number;
    const startPort = ns.getPortHandle(ns.args[4] as number);
    const finishPort = ns.getPortHandle(ns.args[5] as number);
    const finishBarrierPort = ns.getPortHandle(ns.args[6] as number);
    const skip = ns.args[7] as boolean;

    let hack: any;

    if (skip) {
        hack = ns.asleep(end - time);
    } else {
        hack = ns.hack(target, {additionalMsec: Math.max(0, delay)});
    }

    write_message_started(startPort, id, time, delay);
    await hack;

    return ns.atExit(async () => {
        write_message_finished(finishPort, id, get_time());
        await finishBarrierPort.nextWrite();
    });
}
