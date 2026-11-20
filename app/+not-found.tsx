import { Link, Stack } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, shared, spacing } from '@/constants/theme';

// Hammer Lane Co branding: the app icon art (deep-red long-nose rig on
// dark navy) instead of any stock illustration.
const appIcon = require('../assets/images/icon.png');

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={styles.container}>
        <Image source={appIcon} style={styles.logo} accessibilityLabel="Hammer Lane Co truck logo" />
        <Text style={shared.title}>Wrong exit, driver.</Text>
        <Text style={styles.sub}>This screen doesn&apos;t exist.</Text>
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
  logo: {
    borderRadius: 26,
    height: 120,
    marginBottom: spacing.lg,
    width: 120,
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
