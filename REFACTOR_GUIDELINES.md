# Refactoring Guidelines for Theme & Back Button

You are an expert React Native developer. You have been invoked to refactor a specific set of files.

## 1. Import Theme Constants
At the top of the file, add:
```tsx
import { useThemeColors } from '@/lib/useThemeColors'; // Note: Adjust the relative path if needed! Use ../../lib/useThemeColors for app/folder/file, etc.
import { typography, spacing } from '@/lib/theme';
```
Since you might not have aliases set up, please use relative paths (e.g. `../../lib/useThemeColors` for `src/app/deck/[deckId]/browse.tsx` or `../lib/useThemeColors` for `src/app/index.tsx` or `../../lib/theme` for `src/components/ui/BottomBar.tsx`). Calculate the correct relative path!

## 2. Standardize Back Button
If the file contains a Back button constructed using `<Pressable>` and a `"<- Back"` or `"← Back"` text:
- Replace it entirely with `<BackButton />`.
- Add `import { BackButton } from '@/components/ui/BackButton'` (again, use the correct relative path).
- Remove the old `backBtn` or `backButton` styles if they are no longer used.

## 3. Replace Hardcoded Colors, Spacing, and Typography
Inside the component, invoke the hook:
```tsx
const colors = useThemeColors();
```
Then, update the elements to use dynamic styling. For React Native, `StyleSheet.create` cannot use hook values directly. Therefore, you must pass the dynamic properties inline to override or supplement the static styles.

Example transformation:
**Before:**
```tsx
<View style={styles.container}>
  <Text style={styles.title}>Hello</Text>
</View>
...
const styles = StyleSheet.create({
  container: { backgroundColor: '#121212', padding: 16 },
  title: { fontSize: 24, color: '#FFFFFF' }
});
```

**After:**
```tsx
const colors = useThemeColors();

<View style={[styles.container, { backgroundColor: colors.background }]}>
  <Text style={[styles.title, { color: colors.text }]}>Hello</Text>
</View>
...
const styles = StyleSheet.create({
  container: { padding: spacing[4] },
  title: { fontSize: typography['2xl'] }
});
```

- **Paddings/Margins**: If a style object has `padding: 16` or `margin: 8`, map it to `spacing[4]` and `spacing[2]` (or whichever is closest). You CAN leave these inside `StyleSheet.create` since spacing is static.
- **Font Sizes**: If a style object has `fontSize: 16`, map it to `typography.base`. Again, these CAN stay inside `StyleSheet.create`.
- **Colors**: Remove `color`, `backgroundColor`, `borderColor`, etc. from `StyleSheet.create` if they are hardcoded. Move them inline as `{[styles.element, { color: colors.primary }]}`. Map `#FFFFFF` to `colors.card` or `colors.text` depending on context. Just make your best mapping. The theme object `colors` has: `background`, `card`, `text`, `textSecondary`, `primary`, `secondary`, `accent`, `border`, `error`, `success`, `warning`, `danger`, `info`, `navBg`, `navBgEnd`, `buttonBackground`, `buttonText`.

## 4. Execution
Use `replace_file_content` or `multi_replace_file_content` to make these changes. Report back via `send_message` when all files assigned to you are done.
