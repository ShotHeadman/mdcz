declare module "opencc-js" {
  export interface ConverterOptions {
    from?: "cn" | "tw" | "twp" | "hk" | "jp" | "t";
    to?: "cn" | "tw" | "twp" | "hk" | "jp" | "t";
  }

  export function Converter(options?: ConverterOptions): (input: string) => string;
}
