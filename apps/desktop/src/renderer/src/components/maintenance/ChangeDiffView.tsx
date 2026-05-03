import {
  type ChangeDiffViewProps,
  type MaintenanceImageOptionProps,
  type MaintenanceSceneImageOptionProps,
  ChangeDiffView as SharedChangeDiffView,
} from "@mdcz/views/maintenance";
import { ImageOptionCard } from "@/components/ImageOptionCard";
import { SceneImageGallery } from "@/components/SceneImageGallery";

const renderImageOption = (props: MaintenanceImageOptionProps) => <ImageOptionCard {...props} stacked />;

const renderSceneImages = (props: MaintenanceSceneImageOptionProps) => <SceneImageGallery {...props} />;

export default function ChangeDiffView(props: ChangeDiffViewProps) {
  return (
    <SharedChangeDiffView {...props} renderImageOption={renderImageOption} renderSceneImages={renderSceneImages} />
  );
}
