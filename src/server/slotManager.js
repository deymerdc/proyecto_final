class SlotManager {
    constructor(totalSlots) {
        this.totalSlots = totalSlots;
        this.slots = Array(totalSlots).fill(null); // Array to keep track of users in slots
    }

    assignSlot(username) {
        // Check if the user already has a slot
        let currentSlot = this.getSlot(username);
        if (currentSlot !== -1) {
            return currentSlot;
        }

        // Assign a new slot if the user doesn't already have one
        for (let i = 0; i < this.totalSlots; i++) {
            if (!this.slots[i]) {
                this.slots[i] = username;
                console.log(`Slot ${i} assigned to ${username}`);
                return i;
            }
        }
        return -1; // No available slot
    }

    releaseSlot(username) {
        for (let i = 0; i < this.totalSlots; i++) {
            if (this.slots[i] === username) {
                this.slots[i] = null;
                console.log(`Slot ${i} released from ${username}`);
                return i;
            }
        }
        return -1; // User not found in any slot
    }

    getSlot(username) {
        for (let i = 0; i < this.totalSlots; i++) {
            if (this.slots[i] === username) {
                return i;
            }
        }
        return -1; // User not found in any slot
    }
}

export default SlotManager;
