import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { colors } from '@/constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} size={size} color={color as string} />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 76,
          paddingTop: 8,
        },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text, fontWeight: '800', fontSize: 20 },
        headerTintColor: colors.text,
      }}>
      <Tabs.Screen
        name="map"
        options={{ title: 'Map', tabBarIcon: tabIcon('map-outline') }}
      />
      <Tabs.Screen
        name="stops"
        options={{ title: 'Truck Stops', tabBarIcon: tabIcon('storefront-outline') }}
      />
      <Tabs.Screen
        name="fuel"
        options={{ title: 'Fuel', tabBarIcon: tabIcon('flame-outline') }}
      />
      <Tabs.Screen
        name="weigh"
        options={{ title: 'Weigh Stations', tabBarIcon: tabIcon('speedometer-outline') }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: tabIcon('menu-outline') }}
      />
    </Tabs>
  );
}
