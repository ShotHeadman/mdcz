import type { ActorSourceName, BaseActorSource } from "./types";

export class ActorSourceRegistry {
  private readonly sources = new Map<ActorSourceName, BaseActorSource>();

  constructor(sources: BaseActorSource[] = []) {
    for (const source of sources) {
      this.register(source);
    }
  }

  register(source: BaseActorSource): this {
    this.sources.set(source.name, source);
    return this;
  }

  get(name: ActorSourceName): BaseActorSource | undefined {
    return this.sources.get(name);
  }
}
