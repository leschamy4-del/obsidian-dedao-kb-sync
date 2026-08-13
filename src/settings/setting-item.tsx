import type { ComponentChildren } from 'preact';

interface SettingItemProps {
  name: string;
  description?: string | ComponentChildren;
  heading?: boolean;
  className?: string;
  children: ComponentChildren;
}

export function SettingItem({ name, description, heading, className, children }: SettingItemProps) {
  return (
    <div className={`setting-item${heading ? ' setting-item-heading' : ''}${className ? ' ' + className : ''}`}>
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        {description && <div className="setting-item-description">{description}</div>}
      </div>
      <div className="setting-item-control">{children}</div>
    </div>
  );
}
