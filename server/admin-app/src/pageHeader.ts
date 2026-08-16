import type { Dispatch, ReactNode, SetStateAction } from "react";

export type PageHeaderConfig = {
  count?: ReactNode;
  actions?: ReactNode;
};

export type PageHeaderSetter = Dispatch<SetStateAction<PageHeaderConfig | null>>;
