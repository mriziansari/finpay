import type { DomainEvent, DomainEventType, EventPayloadFor } from "./event.types.js";

type EventHandler<T extends DomainEventType> = ( payload: EventPayloadFor<T>, event: DomainEvent) => Promise<void> | void;

class EventBus {
    private handlers = new Map<string, Array<EventHandler<any>>>();

    // Register an asynchronous listener for an event type.
    subscribe<T extends DomainEventType>(eventType: T, handler: EventHandler<T>): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }


//Publish an event to all registered listeners.

async publish(event: DomainEvent): Promise<void> {
    const listeners = this.handlers.get(event.eventType) || [];
    for (const listener of listeners) {
      try {
        await listener(event.payload, event);
      } catch (error) {
        console.error(`[EventBus] Error handling event ${event.eventType}:`, error);
        throw error;
      }
    }
  }
}

// Singleton instance shared across the application
export const eventBus = new EventBus();