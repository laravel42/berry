import { Badge } from '@/components/ui/badge';
import { Project } from '@/data/projects';
import Link from 'next/link';
import { WORKSPACE_SLUG } from '@/lib/config';

export function ProjectBadge({ project }: { project: Project }) {
   return (
      <Link
         href={`/${WORKSPACE_SLUG}/projects`}
         className="min-w-0 max-w-full"
         title={project.name}
      >
         <Badge
            variant="outline"
            className="max-w-full min-w-0 shrink gap-1.5 overflow-hidden rounded-full bg-background text-muted-foreground"
         >
            <project.icon size={16} className="shrink-0" />
            <span className="min-w-0 truncate">{project.name}</span>
         </Badge>
      </Link>
   );
}
