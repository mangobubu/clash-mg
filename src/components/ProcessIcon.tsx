import { AppstoreOutlined } from "@ant-design/icons";

interface ProcessIconProps {
  app: string;
  icon: string;
}

export function ProcessIcon({ app, icon }: ProcessIconProps) {
  return (
    <span className="app-process-icon" aria-label={`${app} 图标`}>
      {icon.startsWith("data:image/")
        ? <img src={icon} alt="" />
        : <AppstoreOutlined aria-hidden="true" />}
    </span>
  );
}
