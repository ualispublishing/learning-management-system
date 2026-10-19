import React from 'react';
import { useRouter } from 'expo-router';
import { PreparedAIShowcase } from '../components/lms/PreparedAIShowcase';
import { useLMSStore } from '../lib/store/useLMSStore';

export default function AIDemoScreen() {
  const router = useRouter();
  const currentUserId = useLMSStore(state => state.currentUserId);
  return <PreparedAIShowcase onNavigate={path => {
    if (path === '/admin' && !currentUserId) router.push({ pathname: '/demo', params: { signIn: '1' } });
    else router.push(path);
  }} />;
}
