import type { ServerApiContract } from "@mdcz/shared/serverApi";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./routers";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

type InputValue<TInput> = undefined extends TInput ? Exclude<TInput, void> | undefined : Exclude<TInput, void>;

type ProcedureArgs<TInput> = [TInput] extends [undefined]
  ? []
  : [Exclude<TInput, void>] extends [never]
    ? []
    : undefined extends TInput
      ? [input?: InputValue<TInput>]
      : [input: Exclude<TInput, void>];

type ProcedureFn<TInput, TOutput> = (...args: ProcedureArgs<TInput>) => Promise<TOutput>;

type MapProcedures<TInputs, TOutputs> = {
  [K in keyof TInputs & keyof TOutputs]: ProcedureFn<TInputs[K], TOutputs[K]>;
};

type MapConfig<TInputs, TOutputs> = {
  [K in keyof TInputs & keyof TOutputs]: K extends "profiles"
    ? MapProcedures<TInputs[K], TOutputs[K]>
    : ProcedureFn<TInputs[K], TOutputs[K]>;
};

type Jsonify<T> = T extends Date
  ? string
  : T extends Promise<infer U>
    ? Promise<Jsonify<U>>
    : T extends (...args: infer A) => infer R
      ? (...args: { [I in keyof A]: Jsonify<A[I]> }) => Jsonify<R>
      : T extends readonly (infer U)[]
        ? Jsonify<U>[]
        : T extends object
          ? {
              [K in keyof T as undefined extends T[K] ? never : K]: Jsonify<T[K]>;
            } & {
              [K in keyof T as undefined extends T[K] ? K : never]?: Jsonify<T[K]>;
            }
          : T;

type RouterContract = {
  [K in keyof RouterInputs & keyof RouterOutputs]: K extends "config"
    ? MapConfig<RouterInputs[K], RouterOutputs[K]>
    : MapProcedures<RouterInputs[K], RouterOutputs[K]>;
};

type JsonServerApiContract = Jsonify<ServerApiContract>;

const _routerCoversContract: JsonServerApiContract = null as unknown as RouterContract;
const _contractCoversRouter: RouterContract = null as unknown as JsonServerApiContract;

void _routerCoversContract;
void _contractCoversRouter;
