import type { Configuration } from "@mdcz/shared/config";
import type { ActorProfile } from "@mdcz/shared/types";
import type { RuntimeNetworkClient } from "../network";
import { noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { ActorImageFileStore, type ActorImageLookupOptions } from "./actorImage/ActorImageFileStore";
import { ActorPhotoMaterializer } from "./actorImage/ActorPhotoMaterializer";
import { mergeActorProfiles, normalizeActorName, toUniqueActorNames } from "./actorImage/utils";
import type { RuntimeActorImageService, RuntimeActorSourceHint } from "./actorOutput";
import { throwIfAborted } from "./utils/abort";

export { resolveActorPhotoFolderPath, usesLocalActorImageSource } from "./actorImage/actorPhotoPath";

export interface RuntimeActorSourceProvider {
  lookup(
    configuration: Configuration,
    query: {
      name: string;
      aliases?: string[];
      requiredField?: "photo_url";
      sourceHints?: RuntimeActorSourceHint[];
    },
  ): Promise<{
    profile: ActorProfile;
    profileSources: Partial<Record<keyof ActorProfile, string>>;
  }>;
}

export interface ActorImageServiceDependencies {
  cacheRoot: string;
  logger?: RuntimeLogger;
  networkClient?: Pick<RuntimeNetworkClient, "getContent">;
}

type PrepareActorProfilesInput = {
  movieDir: string;
  actors: string[];
  actorProfiles?: ActorProfile[];
  actorPhotoBaseDir?: string;
  actorSourceProvider?: unknown;
  sourceHints?: RuntimeActorSourceHint[];
  signal?: AbortSignal;
};

type ResolvedActorImage = {
  profile: ActorProfile | undefined;
  imagePath: string | undefined;
};

type ActorImageResolutionState = {
  profile: ActorProfile | undefined;
  lookupNames: string[];
  imagePath: string | undefined;
};

const hasActorPhoto = (profile: ActorProfile | undefined): boolean => Boolean(profile?.photo_url?.trim());
const isRemoteUrl = (value: string): boolean => /^https?:\/\//iu.test(value);
const isRuntimeActorSourceProvider = (value: unknown): value is RuntimeActorSourceProvider =>
  typeof value === "object" && value !== null && "lookup" in value && typeof value.lookup === "function";

export class ActorImageService implements RuntimeActorImageService {
  private readonly logger: RuntimeLogger;

  private readonly fileStore: ActorImageFileStore;

  private readonly photoMaterializer: ActorPhotoMaterializer;

  constructor(deps: ActorImageServiceDependencies) {
    this.logger = deps.logger ?? noopRuntimeLogger;
    this.fileStore = new ActorImageFileStore({
      cacheRoot: deps.cacheRoot,
      logger: this.logger,
      networkClient: deps.networkClient,
    });
    this.photoMaterializer = new ActorPhotoMaterializer(this.logger);
  }

  async resolveLocalImage(
    configuration: Configuration,
    actorNames: string[],
    options: ActorImageLookupOptions = {},
  ): Promise<string | undefined> {
    return await this.fileStore.resolveLocalImage(configuration, actorNames, options);
  }

  async materializeForMovie(movieDir: string, actorName: string, sourcePath: string): Promise<string | undefined> {
    return await this.photoMaterializer.materializeForMovie(movieDir, actorName, sourcePath);
  }

  async prepareActorProfilesForMovie(
    configuration: Configuration,
    input: PrepareActorProfilesInput,
  ): Promise<ActorProfile[] | undefined> {
    throwIfAborted(input.signal);

    const seedProfilesByName = this.indexProfilesByName(input.actorProfiles);
    const preparedProfiles: ActorProfile[] = [];
    const seenActorNames = new Set<string>();

    for (const rawActorName of input.actors) {
      throwIfAborted(input.signal);

      const actorName = rawActorName.trim();
      const normalizedName = normalizeActorName(actorName);
      if (!normalizedName || seenActorNames.has(normalizedName)) {
        continue;
      }
      seenActorNames.add(normalizedName);

      const preparedProfile = await this.prepareActorProfileForMovie(
        configuration,
        actorName,
        seedProfilesByName.get(normalizedName),
        input,
      );
      preparedProfiles.push(preparedProfile);
    }

    return preparedProfiles.length > 0 ? preparedProfiles : undefined;
  }

  private async prepareActorProfileForMovie(
    configuration: Configuration,
    actorName: string,
    seedProfile: ActorProfile | undefined,
    input: PrepareActorProfilesInput,
  ): Promise<ActorProfile> {
    const resolvedActorImage = await this.resolveActorImagePath(configuration, actorName, seedProfile, input);

    throwIfAborted(input.signal);

    if (!resolvedActorImage.imagePath) {
      return {
        ...resolvedActorImage.profile,
        name: actorName,
        photo_url: undefined,
      };
    }

    const relativePhotoPath = await this.photoMaterializer.materializeForMovie(
      input.movieDir,
      actorName,
      resolvedActorImage.imagePath,
    );
    if (!relativePhotoPath) {
      this.logger.warn(`Failed to materialize actor photo for ${actorName} from ${resolvedActorImage.imagePath}`);
    }

    return {
      ...resolvedActorImage.profile,
      name: actorName,
      photo_url: relativePhotoPath,
    };
  }

  private async resolveActorImagePath(
    configuration: Configuration,
    actorName: string,
    seedProfile: ActorProfile | undefined,
    input: PrepareActorProfilesInput,
  ): Promise<ResolvedActorImage> {
    let state = this.createResolutionState(actorName, seedProfile);

    state = await this.lookupStoredActorImage(configuration, input, state);
    if (state.imagePath) {
      return this.toResolvedActorImage(state);
    }

    state = await this.lookupActorProfileAndStoredImage(configuration, actorName, seedProfile, input, state);
    if (state.imagePath) {
      return this.toResolvedActorImage(state);
    }

    state = await this.cacheProfilePhoto(input, state);
    if (state.imagePath) {
      return this.toResolvedActorImage(state);
    }

    state = await this.refreshActorProfileAndStoredImage(configuration, actorName, input, state);
    if (state.imagePath) {
      return this.toResolvedActorImage(state);
    }

    state = await this.cacheProfilePhoto(input, state);
    return this.toResolvedActorImage(state);
  }

  private buildLookupNames(actorName: string, profile: ActorProfile | undefined): string[] {
    return toUniqueActorNames([actorName, profile?.name, ...(profile?.aliases ?? [])]);
  }

  private createResolutionState(
    actorName: string,
    profile: ActorProfile | undefined,
    imagePath?: string,
  ): ActorImageResolutionState {
    return {
      profile,
      lookupNames: this.buildLookupNames(actorName, profile),
      imagePath,
    };
  }

  private toResolvedActorImage(state: ActorImageResolutionState): ResolvedActorImage {
    return {
      profile: state.profile,
      imagePath: state.imagePath,
    };
  }

  private async lookupStoredActorImage(
    configuration: Configuration,
    input: PrepareActorProfilesInput,
    state: ActorImageResolutionState,
  ): Promise<ActorImageResolutionState> {
    if (state.imagePath) {
      return state;
    }

    const imagePath = await this.resolveStoredImage(configuration, state.lookupNames, input, state.profile?.photo_url);
    return {
      ...state,
      imagePath,
    };
  }

  private async lookupActorProfileAndStoredImage(
    configuration: Configuration,
    actorName: string,
    existingProfile: ActorProfile | undefined,
    input: PrepareActorProfilesInput,
    state: ActorImageResolutionState,
  ): Promise<ActorImageResolutionState> {
    const profile = await this.resolveActorProfile(
      configuration,
      actorName,
      existingProfile,
      input.actorSourceProvider,
      input.sourceHints,
      input.signal,
    );
    const nextState = this.createResolutionState(actorName, profile, state.imagePath);
    return await this.lookupStoredActorImage(configuration, input, nextState);
  }

  private async cacheProfilePhoto(
    input: PrepareActorProfilesInput,
    state: ActorImageResolutionState,
  ): Promise<ActorImageResolutionState> {
    if (state.imagePath) {
      return state;
    }

    const imagePath = await this.fileStore.cacheActorImage(state.lookupNames, state.profile?.photo_url, input.signal);

    return {
      ...state,
      imagePath,
    };
  }

  private async refreshActorProfileAndStoredImage(
    configuration: Configuration,
    actorName: string,
    input: PrepareActorProfilesInput,
    state: ActorImageResolutionState,
  ): Promise<ActorImageResolutionState> {
    const refreshedProfile = await this.resolveActorProfile(
      configuration,
      actorName,
      state.profile,
      input.actorSourceProvider,
      input.sourceHints,
      input.signal,
      { forceLookup: true },
    );

    if (!refreshedProfile?.photo_url || refreshedProfile.photo_url === state.profile?.photo_url) {
      return state;
    }

    const refreshedState = this.createResolutionState(actorName, refreshedProfile, state.imagePath);
    return await this.lookupStoredActorImage(configuration, input, refreshedState);
  }

  private async resolveStoredImage(
    configuration: Configuration,
    lookupNames: string[],
    input: PrepareActorProfilesInput,
    photoUrl: string | undefined,
  ): Promise<string | undefined> {
    return await this.fileStore.resolveLocalImage(configuration, lookupNames, {
      fallbackBaseDir: input.actorPhotoBaseDir,
      expectedRemoteUrl: this.toExpectedRemoteUrl(photoUrl),
    });
  }

  private toExpectedRemoteUrl(photoUrl: string | undefined): string | undefined {
    return isRemoteUrl(photoUrl ?? "") ? photoUrl : undefined;
  }

  private indexProfilesByName(actorProfiles: ActorProfile[] | undefined): Map<string, ActorProfile> {
    const profilesByName = new Map<string, ActorProfile>();

    for (const profile of actorProfiles ?? []) {
      const lookupNames = toUniqueActorNames([profile.name, ...(profile.aliases ?? [])]);
      for (const lookupName of lookupNames) {
        const normalizedName = normalizeActorName(lookupName);
        if (!normalizedName) {
          continue;
        }

        profilesByName.set(normalizedName, profile);
      }
    }

    return profilesByName;
  }

  private async resolveActorProfile(
    configuration: Configuration,
    actorName: string,
    existingProfile: ActorProfile | undefined,
    actorSourceProvider?: unknown,
    sourceHints?: RuntimeActorSourceHint[],
    signal?: AbortSignal,
    options: { forceLookup?: boolean } = {},
  ): Promise<ActorProfile | undefined> {
    if (
      (!options.forceLookup && hasActorPhoto(existingProfile)) ||
      !isRuntimeActorSourceProvider(actorSourceProvider)
    ) {
      return existingProfile;
    }

    throwIfAborted(signal);

    const lookup = await actorSourceProvider.lookup(configuration, {
      name: actorName,
      aliases: existingProfile?.aliases,
      requiredField: "photo_url",
      sourceHints,
    });

    throwIfAborted(signal);

    if (lookup.profile.photo_url) {
      this.logger.info(
        `Resolved actor photo URL for ${actorName} from ${lookup.profileSources.photo_url ?? "unknown"}: ${
          lookup.profile.photo_url
        }`,
      );
    }

    return (
      mergeActorProfiles(
        [
          { name: actorName, aliases: existingProfile?.aliases },
          ...(options.forceLookup ? [lookup.profile, existingProfile] : [existingProfile, lookup.profile]),
        ].filter((profile): profile is ActorProfile => Boolean(profile)),
      ) ?? existingProfile
    );
  }
}
