/**
 * @fileoverview src/app/(tabs)/_layout.tsx.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemeColors } from '../../lib/useThemeColors';
import { useLMSStore } from '../../lib/store/useLMSStore';
import { canUserAccessThread } from '../../lib/chat/threadPolicy';

export default function TabLayout() {
  const colors = useThemeColors();
  const courses = useLMSStore(state => state.courses);
  const threads = useLMSStore(state => state.threads);
  const directThreads = useLMSStore(state => state.directThreads);
  const currentUserId = useLMSStore(state => state.currentUserId);
  const courseUpdateCount = courses.filter(course => course.hasUpdates).length;
  const accessibleThreads = [...threads, ...directThreads].filter(thread => {
    const course = thread.courseId ? courses.find(candidate => candidate.id === thread.courseId) : undefined;
    const role = course?.staff.find(member => member.id === currentUserId)?.role;
    return canUserAccessThread(thread, course, currentUserId, role);
  });
  const unreadChatCount = Array.from(new Map(accessibleThreads.map(thread => [thread.id, thread])).values())
    .reduce((total, thread) => total + Math.max(0, thread.unreadCount || 0), 0);

  return (
    <Tabs screenOptions={{ 
      headerShown: false, 
      tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textSecondary,
      tabBarBadgeStyle: { backgroundColor: colors.error, color: colors.onError },
    }}>

      <Tabs.Screen name="admin" options={{ 
        title: 'Courses',
        tabBarAccessibilityLabel: courseUpdateCount ? `Courses, ${courseUpdateCount} update${courseUpdateCount === 1 ? '' : 's'}` : 'Courses',
        tabBarBadge: courseUpdateCount || undefined,
        tabBarIcon: ({ color, size }) => <Ionicons name="school-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="index" options={{ 
        title: 'Learn',
        tabBarAccessibilityLabel: 'Learn and flashcards',
        tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="chat" options={{ 
        title: 'Chat',
        tabBarAccessibilityLabel: unreadChatCount ? `Chat, ${unreadChatCount} unread message${unreadChatCount === 1 ? '' : 's'}` : 'Chat',
        tabBarBadge: unreadChatCount || undefined,
        tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} />,
      }} />
    </Tabs>
  );
}
