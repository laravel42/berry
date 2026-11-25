import { useLocalSearchParams } from 'expo-router';

import { ProjectDetailScreen } from '@/features/projects/project-detail-screen';

export default function ProjectDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProjectDetailScreen projectId={typeof id === 'string' ? id : ''} />;
}
