import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, shared, spacing } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={styles.container}>
        <Text style={shared.title}>Wrong exit, driver.</Text>
        <Text style={styles.sub}>This screen doesn't exist.</Text>
        <Link href="/map" style={styles.link}>
          <Text style={styles.linkText}>Back to the map →</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sub: {
    color: colors.muted,
    fontSize: 16,
    marginTop: spacing.xs,
  },
  link: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  linkText: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '800',
  },
});
