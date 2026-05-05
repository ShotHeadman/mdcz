import { toErrorMessage } from "@mdcz/shared/error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "../client";
import { ErrorBanner } from "../routeCommon";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PasswordInput,
  Progress,
} from "../ui";

// Web-only route: setup is the server first-run wizard for admin auth and mounted media-root registration.
// Desktop persists local settings directly and has no browser-accessible first-run/auth boundary.
export const SetupPage = () => {
  const queryClient = useQueryClient();
  const setupQ = useQuery({ queryKey: ["setup"], queryFn: () => api.setup.status(), retry: false });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      password: "",
      confirmPassword: "",
      displayName: "媒体库",
      hostPath: "",
    },
  });

  const { watch, setValue, trigger } = form;
  const password = watch("password");
  const displayName = watch("displayName");
  const hostPath = watch("hostPath");

  useEffect(() => {
    if (setupQ.data?.environmentPassword) {
      setValue("password", setupQ.data.environmentPassword);
      setValue("confirmPassword", setupQ.data.environmentPassword);
    }
  }, [setupQ.data?.environmentPassword, setValue]);

  const completeM = useMutation({
    mutationFn: () =>
      api.setup.complete({
        password,
        mediaRoot: { displayName, hostPath, enabled: true },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      window.location.href = "/";
    },
  });

  const nextPasswordStep = async () => {
    setError(null);
    const isValid = await trigger(["password", "confirmPassword"]);
    if (!isValid) return;
    setStep(1);
  };

  const completeSetup = async () => {
    setError(null);
    const isValid = await trigger(["displayName", "hostPath"]);
    if (!isValid) return;

    try {
      await completeM.mutateAsync();
    } catch (setupError) {
      setError(toErrorMessage(setupError));
      setStep(1);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-canvas px-6 py-12 text-foreground">
      <div className="w-full max-w-xl space-y-8">
        <header className="space-y-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-quiet-lg bg-primary text-xl font-bold text-primary-foreground shadow-sm">
              M
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">MDCz Setup</p>
          </div>
        </header>

        <div className="relative mx-auto w-full px-12">
          <div className="absolute top-2 left-0 w-full px-[3.5rem]">
            <Progress className="h-1 bg-surface-low" value={(step / 2) * 100} />
          </div>
          <div className="relative flex justify-between">
            {["密码", "完成"].map((label, index) => (
              <div
                className={`flex flex-col items-center gap-3 ${index <= step ? "text-primary" : "text-muted-foreground"}`}
                key={label}
              >
                <div
                  className={`z-10 h-4 w-4 rounded-full border-2 bg-surface transition-colors duration-300 ${
                    index <= step ? "border-primary" : "border-surface-low"
                  }`}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Form {...form}>
          <Card className="overflow-hidden border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)]">
            {step === 0 && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <CardHeader className="pb-8">
                  <CardTitle className="text-xl">设置管理员密码</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-5">
                    <FormField
                      control={form.control}
                      name="password"
                      rules={{ required: "请输入密码" }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>密码</FormLabel>
                          <FormControl>
                            <PasswordInput placeholder="••••••••" autoFocus {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      rules={{
                        required: "请确认密码",
                        validate: (value) => value === password || "两次输入的密码不一致",
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>确认密码</FormLabel>
                          <FormControl>
                            <PasswordInput placeholder="••••••••" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-end pt-4">
                    <Button className="h-11 px-10 rounded-quiet-capsule font-semibold" onClick={nextPasswordStep}>
                      继续
                    </Button>
                  </div>
                </CardContent>
              </div>
            )}

            {step === 1 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <CardHeader className="pb-8">
                  <CardTitle className="text-xl">配置首个媒体库</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-5">
                    <FormField
                      control={form.control}
                      name="displayName"
                      rules={{ required: "请输入媒体库名称" }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>媒体库显示名称</FormLabel>
                          <FormControl>
                            <Input placeholder="例如：电影、剧集" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="hostPath"
                      rules={{ required: "请输入文件夹路径" }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>库文件夹路径</FormLabel>
                          <FormControl>
                            <Input placeholder="/mnt/media/movies" {...field} />
                          </FormControl>
                          <FormDescription>请输入系统已挂载的媒体文件夹绝对路径。</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-between gap-4 pt-4">
                    <Button variant="secondary" className="h-11 px-8 rounded-quiet-capsule" onClick={() => setStep(0)}>
                      上一步
                    </Button>
                    <Button
                      className="h-11 px-10 rounded-quiet-capsule font-semibold"
                      disabled={completeM.isPending}
                      onClick={() => void completeSetup()}
                    >
                      {completeM.isPending ? "正在初始化..." : "开始使用"}
                    </Button>
                  </div>
                </CardContent>
              </div>
            )}
          </Card>
        </Form>
      </div>
    </main>
  );
};

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});
