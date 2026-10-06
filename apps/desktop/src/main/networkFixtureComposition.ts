import { attachNetworkFixtureCaseId } from "@mdcz/runtime/network/networkFixtureCase";
import { createDevNetworkClient } from "@mdcz/runtime/network/networkFixtureFactory";

export const createAppNetworkClient = createDevNetworkClient;

export const prepareAppScrapeItem = attachNetworkFixtureCaseId;
