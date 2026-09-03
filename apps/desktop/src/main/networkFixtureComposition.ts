import type { NetworkClientOptions } from "@mdcz/runtime/network";
import { attachNetworkFixtureCaseId } from "@mdcz/runtime/network/networkFixtureCase";
import { createNetworkFixtureClient, finalizeNetworkFixtures } from "@mdcz/runtime/network/networkFixtureFactory";

export const createAppNetworkClient = (options: NetworkClientOptions) => createNetworkFixtureClient(options);

export const finalizeAppNetwork = finalizeNetworkFixtures;

export const prepareAppScrapeItem = attachNetworkFixtureCaseId;
