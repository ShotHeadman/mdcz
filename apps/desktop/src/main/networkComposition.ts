import { NetworkClient, type NetworkClientOptions } from "@mdcz/runtime/network";

export const createAppNetworkClient = (options: NetworkClientOptions): NetworkClient => new NetworkClient(options);

export const finalizeAppNetwork = async (): Promise<void> => undefined;

export const prepareAppScrapeItem = <T>(item: T): T => item;
