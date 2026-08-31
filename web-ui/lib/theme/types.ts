export type ThemeVariant = "light" | "dark";

export interface ThemeMetadata {
  id: string;
  name: string;
  description: string;
  variant: ThemeVariant;
  tags: string[];
}

export interface ThemeColor {
  base: string;
  hover: string;
  active: string;
  foreground: string;
  muted: string;
}

export interface Theme {
  metadata: ThemeMetadata;
  colors: {
    primary: ThemeColor;
    surface: {
      background: string;
      foreground: string;
      muted: string;
      mutedForeground: string;
      elevated: string;
      elevatedForeground: string;
      overlay: string;
      subtle: string;
    };
    interactive: {
      border: string;
      borderHover: string;
      borderFocus: string;
      selection: string;
      selectionForeground: string;
      focus: string;
      focusRing: string;
      cursor: string;
      hover: string;
      active: string;
    };
    status: {
      error: string;
      errorForeground: string;
      errorBackground: string;
      errorBorder: string;
      warning: string;
      warningForeground: string;
      warningBackground: string;
      warningBorder: string;
      success: string;
      successForeground: string;
      successBackground: string;
      successBorder: string;
      info: string;
      infoForeground: string;
      infoBackground: string;
      infoBorder: string;
    };
    syntax: {
      background: string;
      foreground: string;
      comment: string;
      keyword: string;
      string: string;
      number: string;
      function: string;
      variable: string;
      type: string;
      operator: string;
      property: string;
      header: string;
      lineNumber: string;
    };
    chart: readonly string[];
    chat: {
      userBackground: string;
      userBorder: string;
      assistantBackground: string;
      toolBackground: string;
      toolBorder: string;
    };
  };
  config?: {
    fonts?: {
      display?: string;
      mono?: string;
    };
  };
}

export interface OpenChamberTheme {
  metadata: {
    id: string;
    name: string;
    description: string;
    variant: ThemeVariant;
    tags: string[];
    version?: string;
    author?: string;
  };
  colors: {
    primary: {
      base: string;
      hover: string;
      active: string;
      foreground: string;
      muted: string;
      emphasis?: string;
    };
    surface: Theme["colors"]["surface"];
    interactive: Theme["colors"]["interactive"];
    status: Theme["colors"]["status"];
    syntax: {
      base: {
        background: string;
        foreground: string;
        comment: string;
        keyword: string;
        string: string;
        number: string;
        function: string;
        variable: string;
        type: string;
        operator: string;
      };
      tokens: Record<string, string>;
      highlights: Record<string, string>;
    };
    chat: {
      userMessage: string;
      userMessageBackground: string;
      assistantMessage: string;
      assistantMessageBackground: string;
      timestamp: string;
      divider: string;
    };
    tools: {
      background: string;
      border: string;
      headerHover: string;
      icon: string;
      title: string;
      description: string;
      edit: {
        added: string;
        addedBackground: string;
        removed: string;
        removedBackground: string;
        lineNumber: string;
      };
    };
  };
  config?: {
    fonts?: {
      sans?: string;
      mono?: string;
      heading?: string;
    };
  };
}
