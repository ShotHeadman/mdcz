import { Button, FormControl } from "@mdcz/ui";
import { FolderOpen } from "lucide-react";
import type { ControllerRenderProps, FieldValues } from "react-hook-form";
import { PathAutocompleteInput } from "../path";
import { useSettingsServices } from "../settings/SettingsServices";

interface ServerPathFieldProps {
  field: ControllerRenderProps<FieldValues, string>;
  label?: string;
  description?: string;
  placeholder?: string;
  isDirectory?: boolean;
}

export function ServerPathField({ field, placeholder, isDirectory = true }: ServerPathFieldProps) {
  const services = useSettingsServices();
  const browsePath = services.browsePath;
  const suggestDirectoryPath = services.suggestDirectoryPath;

  const handleBrowse = async (browse: NonNullable<typeof browsePath>) => {
    const path = await browse(isDirectory ? "directory" : "file");
    if (path) field.onChange(path);
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center gap-2 w-full justify-end">
        <FormControl>
          <PathAutocompleteInput
            value={String(field.value ?? "")}
            placeholder={placeholder}
            loadSuggestions={
              isDirectory && suggestDirectoryPath ? async (value) => await suggestDirectoryPath(value) : undefined
            }
            inputClassName="h-8 text-sm bg-background/50 focus:bg-background transition-all flex-1"
            onBlur={field.onBlur}
            onChange={field.onChange}
          />
        </FormControl>
        {browsePath ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 border-input hover:bg-muted/50"
            onClick={() => void handleBrowse(browsePath)}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
