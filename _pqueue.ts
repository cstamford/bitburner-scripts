export class PriorityQueue<T> {
    private queue: T[] = [];
    private head: number = 0;
    private tail: number = -1;

    constructor(private compareFunction: (a: T, b: T) => number) {}

    enqueue(item: T) {
        //this.debug_validate_order("enqueue");

        if (this.is_empty() || this.compareFunction(item, this.queue[this.tail]) >= 0) {
            this.queue[++this.tail] = item;
        } else {
            const index = this.search(item);
            this.queue.splice(index, 0, item);
            this.tail++;
        }
    }

    search(item: T): number {
        let low = this.head;
        let high = this.tail;

        while (low <= high) {
            const mid = Math.floor(low + (high - low) / 2);
            const comparison = this.compareFunction(item, this.queue[mid]);

            if (comparison == 0) {
                return mid + 1;
            } else if (comparison > 0) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return low;
    }

    dequeue(): T | undefined {
        if (this.is_empty()) {
            return undefined;
        }

        //this.debug_validate_order("dequeue");

        const ret = this.queue[this.head++];

        if (this.head > 1024 && this.head > this.queue.length / 2) {
            this.queue = this.queue.slice(this.head);
            this.tail = this.queue.length - 1;
            this.head = 0;
        } else if (this.head > this.tail) {
            this.clear();
        }

        return ret;
    }

    get(index: number) {
        return this.queue[index];
    }

    peek() : T | undefined {
        return this.is_empty() ? undefined : this.queue[this.head];
    }

    is_empty() : boolean {
        return this.head > this.tail;
    }

    clear() {
        this.head = this.tail + 1;
    }

    length() : number {
        return this.tail - this.head + 1;
    }

    to_array(): T[] {
        return this.queue.slice(this.head, this.tail + 1);
    }

    debug_validate_order(label: string) {
        for (let i = this.head; i < this.tail; i++) {
            if (this.compareFunction(this.queue[i], this.queue[i + 1]) > 0) {
                throw new Error(`${label} order violation between indices ${i} and ${i + 1}: ` +
                    `${JSON.stringify(this.queue[i])} > ${JSON.stringify(this.queue[i + 1])}`);
            }
        }
    }

    [Symbol.iterator]() {
        let index = this.head;
        let queue = this.queue;
        let tail = this.tail;

        return {
            next(): IteratorResult<T> {
                if (index <= tail) {
                    return { value: queue[index++], done: false };
                } else {
                    return { value: undefined, done: true };
                }
            }
        };
    }
}
