import { FolderOpen } from "lucide-react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { ipc } from "@/client/ipc";
import { Button } from "@/components/ui/Button";
import { FormControl } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";

interface ServerPathFieldProps {
  field: ControllerRenderProps<FieldValues, string>;
  label?: string;
  description?: string;
  placeholder?: string;
  isDirectory?: boolean;
}

export function ServerPathField({ field, placeholder, isDirectory = true }: ServerPathFieldProps) {
  const handleBrowse = async () => {
    const response = await ipc.file.browse(isDirectory ? "directory" : "file");
    if (response.paths && response.paths.length > 0) {
      field.onChange(response.paths[0]);
    }
  };

  return (
    <div className="flex items-center gap-2 w-full justify-end">
      <FormControl>
        <Input
          placeholder={placeholder}
          {...field}
          className="h-8 text-sm bg-background/50 focus:bg-background transition-all flex-1"
        />
      </FormControl>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0 border-input hover:bg-muted/50"
        onClick={handleBrowse}
      >
        <FolderOpen className="h-4 w-4" />
      </Button>
    </div>
  );
}
