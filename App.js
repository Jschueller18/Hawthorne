import React, { useState, useEffect } from 'react';
import { 
  Text, 
  View, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  Switch, 
  FlatList, 
  ActivityIndicator, 
  Button,
  Alert,
  TextInput,
  Platform 
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import * as SMS from 'expo-sms';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import 'expo-dev-client';

// Define background task name
const SCREEN_TIME_TASK = 'SCREEN_TIME_UPDATE_TASK';

// Register background task
TaskManager.defineTask(SCREEN_TIME_TASK, async () => {
  try {
    // Check if we should send an update now
    const shouldSend = await checkIfUpdateTime();
    
    if (shouldSend) {
      // Get screen time data
      const screenTimeData = await getScreenTimeData();
      
      // Send to partners
      const result = await sendScreenTimeUpdates(screenTimeData);
      
      if (result) {
        // Save last sent time (no notification)
        await AsyncStorage.setItem('last_update_sent', new Date().toISOString());
        return BackgroundFetch.BackgroundFetchResult.NewData;
      }
    }
    
    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error("Background task error:", error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Function to check if it's time to send an update
const checkIfUpdateTime = async () => {
  // Get the last time an update was sent
  const lastUpdateString = await AsyncStorage.getItem('last_update_sent');
  
  if (lastUpdateString) {
    const lastUpdate = new Date(lastUpdateString);
    const now = new Date();
    
    // Don't send more than once per day
    if (lastUpdate.toDateString() === now.toDateString()) {
      return false;
    }
  }
  
  // Get the scheduled time
  const updateTimeString = await AsyncStorage.getItem('update_time') || '20:00';
  const [scheduledHour, scheduledMinute] = updateTimeString.split(':').map(Number);
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // Create a window around the scheduled time (±45 minutes)
  const isCloseToScheduledTime = (
    (currentHour === scheduledHour && Math.abs(currentMinute - scheduledMinute) <= 45) ||
    (currentHour === scheduledHour - 1 && currentMinute >= 15 && scheduledMinute <= 45) ||
    (currentHour === scheduledHour + 1 && currentMinute <= 45 && scheduledMinute >= 15)
  );
  
  return isCloseToScheduledTime;
};

// Function to get screen time data
const getScreenTimeData = async () => {
  // In a real app, this would connect to native screen time APIs
  // For now, use mock data or stored values
  try {
    // Try to get stored mock data first
    const storedData = await AsyncStorage.getItem('mock_screen_time');
    if (storedData) {
      return JSON.parse(storedData);
    }
    
    // Default mock data
    return { 
      hours: 3, 
      minutes: 45,
      appBreakdown: [
        { name: 'Instagram', time: '1h 15m', category: 'Social' },
        { name: 'YouTube', time: '45m', category: 'Entertainment' },
        { name: 'Chrome', time: '30m', category: 'Productivity' }
      ]
    };
  } catch (error) {
    console.error("Error getting screen time data:", error);
    return { hours: 0, minutes: 0, appBreakdown: [] };
  }
};

// Function to send screen time updates to partners
const sendScreenTimeUpdates = async (screenTimeData) => {
  try {
    // Check if SMS is available
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) {
      console.log("SMS is not available on this device");
      return false;
    }
    
    // Get partners from storage
    const partnersString = await AsyncStorage.getItem('accountability_partners');
    const partners = partnersString ? JSON.parse(partnersString) : [];
    
    if (partners.length === 0) {
      console.log("No accountability partners configured");
      return false;
    }
    
    // Get phone numbers
    const recipients = partners
      .filter(p => p.isPartner)
      .map(p => p.phoneNumber);
    
    if (recipients.length === 0) {
      console.log("No partner phone numbers found");
      return false;
    }
    
    // Get goal from storage
    const goalString = await AsyncStorage.getItem('screen_time_goal');
    const goal = goalString ? JSON.parse(goalString) : { hours: 3, minutes: 0 };
    
    // Calculate if over goal
    const totalMinutes = screenTimeData.hours * 60 + screenTimeData.minutes;
    const goalMinutes = goal.hours * 60 + goal.minutes;
    const isOverGoal = totalMinutes > goalMinutes;
    
    // Create the message
    const message = `[Hawthorne Update] My screen time today was ${screenTimeData.hours}h ${screenTimeData.minutes}m ${
      isOverGoal ? '(over my goal)' : '(under my goal)'
    }`;
    
    // Send the SMS
    const { result } = await SMS.sendSMSAsync(recipients, message);
    
    return result === 'sent';
  } catch (error) {
    console.error("Error sending updates:", error);
    return false;
  }
};

// Register for background tasks
const registerBackgroundTask = async () => {
  try {
    // Unregister any existing task
    await BackgroundFetch.unregisterTaskAsync(SCREEN_TIME_TASK).catch(() => null);
    
    // Register the new task
    await BackgroundFetch.registerTaskAsync(SCREEN_TIME_TASK, {
      minimumInterval: 15 * 60, // 15 minutes minimum
      stopOnTerminate: false,
      startOnBoot: true,
    });
    
    console.log("Background task registered for silent updates");
  } catch (error) {
    console.error("Background task registration failed:", error);
  }
};

// Dashboard Screen
function DashboardScreen() {
  const [screenTime, setScreenTime] = useState({ hours: 3, minutes: 45 });
  const [goal, setGoal] = useState({ hours: 3, minutes: 0 });
  const [updateTime, setUpdateTime] = useState('20:00'); // Default 8:00 PM
  const [autoUpdates, setAutoUpdates] = useState(true);
  const [lastUpdateSent, setLastUpdateSent] = useState(null);
  
  // Calculate if over goal
  const isOverGoal = 
    (screenTime.hours > goal.hours) || 
    (screenTime.hours === goal.hours && screenTime.minutes > goal.minutes);
  
  // Load data on component mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load screen time data
        const data = await getScreenTimeData();
        setScreenTime(data);
        
        // Load goal
        const savedGoal = await AsyncStorage.getItem('screen_time_goal');
        if (savedGoal) {
          setGoal(JSON.parse(savedGoal));
        }
        
        // Load update time
        const savedTime = await AsyncStorage.getItem('update_time');
        if (savedTime) {
          setUpdateTime(savedTime);
        }
        
        // Load auto updates setting
        const autoUpdatesStr = await AsyncStorage.getItem('auto_updates');
        if (autoUpdatesStr !== null) {
          setAutoUpdates(JSON.parse(autoUpdatesStr));
        }
        
        // Load last update time
        const lastSentStr = await AsyncStorage.getItem('last_update_sent');
        if (lastSentStr) {
          setLastUpdateSent(new Date(lastSentStr));
        }
      } catch (error) {
        console.error("Error loading data:", error);
      }
    };
    
    loadData();
  }, []);
  
  // Register/unregister background task when settings change
  useEffect(() => {
    const updateBackgroundTask = async () => {
      await AsyncStorage.setItem('update_time', updateTime);
      await AsyncStorage.setItem('auto_updates', JSON.stringify(autoUpdates));
      
      if (autoUpdates) {
        await registerBackgroundTask();
      } else {
        await BackgroundFetch.unregisterTaskAsync(SCREEN_TIME_TASK).catch(() => null);
      }
    };
    
    updateBackgroundTask();
  }, [updateTime, autoUpdates]);
  
  // Function to manually send update
  const sendUpdatesToPartners = async () => {
    try {
      const result = await sendScreenTimeUpdates(screenTime);
      
      if (result) {
        const now = new Date();
        await AsyncStorage.setItem('last_update_sent', now.toISOString());
        setLastUpdateSent(now);
        Alert.alert("Success", "Your screen time update was sent to your accountability partners!");
      } else {
        Alert.alert("Failed", "Could not send your screen time update. Please check your partners list and try again.");
      }
    } catch (error) {
      console.error("Error sending updates:", error);
      Alert.alert("Error", "There was a problem sending your update.");
    }
  };
  
  // Set time handler
  const handleTimeChange = (newTime) => {
    // Validate time format (HH:MM)
    if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(newTime)) {
      setUpdateTime(newTime);
    } else {
      Alert.alert("Invalid Time", "Please enter time in format HH:MM (e.g., 20:00 for 8:00 PM)");
    }
  };
  
  return (
    <ScrollView style={styles.scrollContainer}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome to Hawthorne</Text>
        <Text style={styles.subGreeting}>Track your screen time and stay accountable</Text>
      </View>
      
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Today's Screen Time</Text>
        <Text style={styles.screenTimeValue}>
          {screenTime.hours}h {screenTime.minutes}m
        </Text>
        
        <View style={styles.goalContainer}>
          <View style={styles.goalRow}>
            <Text style={styles.goalText}>Daily Goal: {goal.hours}h {goal.minutes}m</Text>
            <Text style={isOverGoal ? styles.overGoalText : styles.underGoalText}>
              {isOverGoal ? 'Over Goal' : 'Under Goal'}
            </Text>
          </View>
          
          <View style={styles.progressContainer}>
            <View 
              style={[
                styles.progressBar, 
                { 
                  width: `${Math.min(((screenTime.hours * 60 + screenTime.minutes) / (goal.hours * 60 + goal.minutes)) * 100, 100)}%`,
                  backgroundColor: isOverGoal ? '#FF6B6B' : '#4CAF50'
                }
              ]} 
            />
          </View>
        </View>
      </View>
      
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top Used Apps</Text>
        {(screenTime.appBreakdown || [
          { name: 'Instagram', time: '1h 15m', category: 'Social' },
          { name: 'YouTube', time: '45m', category: 'Entertainment' },
          { name: 'Chrome', time: '30m', category: 'Productivity' }
        ]).map((app, index) => (
          <View key={index} style={styles.appRow}>
            <View style={styles.appIconPlaceholder}>
              <Text style={styles.appIconText}>{app.name.charAt(0)}</Text>
            </View>
            <View style={styles.appInfo}>
              <Text style={styles.appName}>{app.name}</Text>
              <Text style={styles.appCategory}>{app.category}</Text>
            </View>
            <Text style={styles.appTime}>{app.time}</Text>
          </View>
        ))}
      </View>
      
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Automated Updates</Text>
        
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Send daily updates</Text>
          <Switch
            value={autoUpdates}
            onValueChange={setAutoUpdates}
            trackColor={{ false: "#767577", true: "#6A5ACD" }}
            thumbColor={autoUpdates ? "#fff" : "#f4f3f4"}
          />
        </View>
        
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Update time</Text>
          <TextInput
            style={styles.timeInput}
            value={updateTime}
            onChangeText={handleTimeChange}
            placeholder="20:00"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        
        {lastUpdateSent && (
          <View style={styles.lastUpdateRow}>
            <Text style={styles.lastUpdateText}>
              Last update sent: {lastUpdateSent.toLocaleTimeString()} on {lastUpdateSent.toLocaleDateString()}
            </Text>
          </View>
        )}
        
        <TouchableOpacity 
          style={styles.shareButton} 
          onPress={sendUpdatesToPartners}
        >
          <Ionicons name="send" size={18} color="#fff" style={styles.buttonIcon} />
          <Text style={styles.buttonText}>Send Update Now</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// Partners Screen
function PartnersScreen() {
  const [partners, setPartners] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Load saved partners on mount
  useEffect(() => {
    const loadSavedPartners = async () => {
      try {
        const savedPartners = await AsyncStorage.getItem('accountability_partners');
        if (savedPartners) {
          setPartners(JSON.parse(savedPartners));
        }
      } catch (error) {
        console.error("Error loading partners:", error);
      }
    };
    
    loadSavedPartners();
  }, []);
  
  // Function to request contacts permission and load contacts
  const loadContacts = async () => {
    setIsLoading(true);
    
    try {
      // Request permission to access contacts
      const { status } = await Contacts.requestPermissionsAsync();
      
      if (status === 'granted') {
        // Get contacts if permission is granted
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        });
        
        if (data.length > 0) {
          // Process contacts to only include those with phone numbers
          const contactsWithPhones = data
            .filter(contact => contact.phoneNumbers && contact.phoneNumbers.length > 0)
            .map(contact => ({
              id: contact.id,
              name: contact.name,
              phoneNumber: contact.phoneNumbers[0].number,
              isPartner: false
            }));
          
          // Check if any are already marked as partners
          const savedPartnersString = await AsyncStorage.getItem('accountability_partners');
          const savedPartners = savedPartnersString ? JSON.parse(savedPartnersString) : [];
          
          const mergedContacts = contactsWithPhones.map(contact => {
            const existingPartner = savedPartners.find(p => 
              p.phoneNumber === contact.phoneNumber
            );
            return existingPartner ? {...contact, isPartner: true} : contact;
          });
          
          setPartners(mergedContacts.slice(0, 20)); // Limit to first 20 for performance
        }
      } else {
        Alert.alert('Permission Denied', 'Permission to access contacts was denied');
      }
    } catch (error) {
      console.error("Error loading contacts:", error);
      Alert.alert('Error', 'Could not load contacts');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Function to toggle a contact as partner
  const togglePartner = (id) => {
    setPartners(partners.map(partner => 
      partner.id === id 
        ? {...partner, isPartner: !partner.isPartner} 
        : partner
    ));
  };
  
  // Save selected partners
  const savePartners = async () => {
    try {
      const selectedPartners = partners.filter(p => p.isPartner);
      await AsyncStorage.setItem('accountability_partners', JSON.stringify(selectedPartners));
      Alert.alert('Success', `${selectedPartners.length} accountability partners saved!`);
    } catch (error) {
      console.error("Error saving partners:", error);
      Alert.alert('Error', 'Failed to save partners');
    }
  };
  
  // Function to render each contact item
  const renderContactItem = ({ item }) => (
    <TouchableOpacity 
      style={[styles.contactItem, item.isPartner && styles.selectedContact]} 
      onPress={() => togglePartner(item.id)}
    >
      <View style={styles.contactIcon}>
        <Text style={styles.contactInitial}>{item.name.charAt(0)}</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.name}</Text>
        <Text style={styles.contactPhone}>{item.phoneNumber}</Text>
      </View>
      {item.isPartner && (
        <View style={styles.checkmark}>
          <Ionicons name="checkmark-circle" size={24} color="#6A5ACD" />
        </View>
      )}
    </TouchableOpacity>
  );
  
  return (
    <View style={styles.containerStretch}>
      <Text style={styles.title}>Accountability Partners</Text>
      <Text style={styles.text}>
        Select contacts to add as accountability partners who will receive your screen time updates
      </Text>
      
      <TouchableOpacity style={styles.button} onPress={loadContacts}>
        <Ionicons name="people" size={18} color="#fff" style={styles.buttonIcon} />
        <Text style={styles.buttonText}>Load Contacts</Text>
      </TouchableOpacity>
      
      {isLoading ? (
        <ActivityIndicator size="large" color="#6A5ACD" style={{ marginTop: 20 }} />
      ) : (
        <>
          <FlatList
            data={partners}
            renderItem={renderContactItem}
            keyExtractor={item => item.id}
            style={{ marginTop: 20, marginBottom: 10 }}
          />
          
          {partners.length > 0 && (
            <TouchableOpacity style={styles.saveButton} onPress={savePartners}>
              <Ionicons name="save" size={18} color="#fff" style={styles.buttonIcon} />
              <Text style={styles.buttonText}>Save Partners</Text>
            </TouchableOpacity>
          )}
          
          {partners.filter(p => p.isPartner).length > 0 && (
            <Text style={styles.selectedPartnersText}>
              {partners.filter(p => p.isPartner).length} partners selected
            </Text>
          )}
        </>
      )}
    </View>
  );
}

// Goals Screen
function GoalsScreen() {
  const [newGoal, setNewGoal] = useState({ hours: 3, minutes: 0 });
  const [currentGoal, setCurrentGoal] = useState({ hours: 3, minutes: 0 });
  
  // Load saved goal
  useEffect(() => {
    const loadSavedGoal = async () => {
      try {
        const savedGoal = await AsyncStorage.getItem('screen_time_goal');
        if (savedGoal) {
          const parsedGoal = JSON.parse(savedGoal);
          setCurrentGoal(parsedGoal);
          setNewGoal(parsedGoal);
        }
      } catch (error) {
        console.error("Error loading goal:", error);
      }
    };
    
    loadSavedGoal();
  }, []);
  
  // Save goal
  const saveGoal = async () => {
    try {
      await AsyncStorage.setItem('screen_time_goal', JSON.stringify(newGoal));
      setCurrentGoal(newGoal);
      Alert.alert('Success', 'Your screen time goal has been updated!');
    } catch (error) {
      console.error("Error saving goal:", error);
      Alert.alert('Error', 'Failed to save goal');
    }
  };
  
  // Increment/decrement hours
  const changeHours = (increment) => {
    const hours = Math.max(0, Math.min(23, newGoal.hours + increment));
    setNewGoal({ ...newGoal, hours });
  };
  
  // Increment/decrement minutes
  const changeMinutes = (increment) => {
    let minutes = newGoal.minutes + increment;
    let hours = newGoal.hours;
    
    if (minutes < 0) {
      minutes = 55;
      hours = Math.max(0, hours - 1);
    } else if (minutes > 55) {
      minutes = 0;
      hours = Math.min(23, hours + 1);
    }
    
    setNewGoal({ hours, minutes });
  };
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Screen Time Goals</Text>
      <Text style={styles.text}>Set your daily screen time targets</Text>
      
      <View style={styles.goalCard}>
        <Text style={styles.goalCardTitle}>Current Goal</Text>
        <Text style={styles.goalValue}>{currentGoal.hours}h {currentGoal.minutes.toString().padStart(2, '0')}m</Text>
        
        <View style={styles.goalPickerContainer}>
          <View style={styles.goalPickerSection}>
            <Text style={styles.goalPickerLabel}>Hours</Text>
            <View style={styles.goalPickerControls}>
              <TouchableOpacity style={styles.goalButton} onPress={() => changeHours(-1)}>
                <Ionicons name="remove" size={24} color="#6A5ACD" />
              </TouchableOpacity>
              <Text style={styles.goalPickerValue}>{newGoal.hours}</Text>
              <TouchableOpacity style={styles.goalButton} onPress={() => changeHours(1)}>
                <Ionicons name="add" size={24} color="#6A5ACD" />
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={styles.goalPickerSection}>
            <Text style={styles.goalPickerLabel}>Minutes</Text>
            <View style={styles.goalPickerControls}>
              <TouchableOpacity style={styles.goalButton} onPress={() => changeMinutes(-5)}>
                <Ionicons name="remove" size={24} color="#6A5ACD" />
              </TouchableOpacity>
              <Text style={styles.goalPickerValue}>{newGoal.minutes.toString().padStart(2, '0')}</Text>
              <TouchableOpacity style={styles.goalButton} onPress={() => changeMinutes(5)}>
                <Ionicons name="add" size={24} color="#6A5ACD" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
        
        <TouchableOpacity style={styles.button} onPress={saveGoal}>
          <Ionicons name="save" size={18} color="#fff" style={styles.buttonIcon} />
          <Text style={styles.buttonText}>Save Goal</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Profile Screen
function ProfileScreen() {
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);
  
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Profile</Text>
      <Text style={styles.text}>Manage your settings</Text>
      
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>App Settings</Text>
        
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Dark Mode</Text>
          <Switch
            value={darkMode}
            onValueChange={setDarkMode}
            trackColor={{ false: "#767577", true: "#6A5ACD" }}
          />
        </View>
        
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Notifications</Text>
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ false: "#767577", true: "#6A5ACD" }}
          />
        </View>
      </View>
    </View>
  );
}

const Tab = createBottomTabNavigator();

export default function App() {
  // Initialize background tasks on app start
  useEffect(() => {
    const initializeApp = async () => {
      // Check for auto-updates setting
      const autoUpdatesStr = await AsyncStorage.getItem('auto_updates');
      const autoUpdates = autoUpdatesStr !== null ? JSON.parse(autoUpdatesStr) : true;
      
      if (autoUpdates) {
        await registerBackgroundTask();
      }
    };
    
    initializeApp();
  }, []);
  
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName;

            if (route.name === 'Dashboard') {
              iconName = focused ? 'home' : 'home-outline';
            } else if (route.name === 'Partners') {
              iconName = focused ? 'people' : 'people-outline';
            } else if (route.name === 'Goals') {
              iconName = focused ? 'flag' : 'flag-outline';
            } else if (route.name === 'Profile') {
              iconName = focused ? 'person' : 'person-outline';
            }

            return <Ionicons name={iconName} size={size} color={color} />;
          },
          tabBarActiveTintColor: '#6A5ACD',
          tabBarInactiveTintColor: 'gray',
          headerStyle: {
            backgroundColor: '#6A5ACD',
          },
          headerTintColor: '#fff',
        })}
      >
        <Tab.Screen 
          name="Dashboard" 
          component={DashboardScreen}
          options={{ title: 'Hawthorne' }}
        />
        <Tab.Screen name="Partners" component={PartnersScreen} />
        <Tab.Screen name="Goals" component={GoalsScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  containerStretch: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  scrollContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subGreeting: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  text: {
    fontSize: 16,
    textAlign: 'center',
    color: '#333',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    marginHorizontal: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  goalCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    width: '100%',
    marginBottom: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  goalCardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  goalValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#6A5ACD',
    marginBottom: 20,
  },
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  screenTimeValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#6A5ACD',
    textAlign: 'center',
    marginBottom: 15,
  },
  goalContainer: {
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  goalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  goalText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#555',
  },
  overGoalText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FF6B6B',
  },
  underGoalText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4CAF50',
  },
  progressContainer: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  button: {
    backgroundColor: '#6A5ACD',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 10,
  },
  saveButton: {
    backgroundColor: '#6A5ACD',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 10,
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  shareButton: {
    backgroundColor: '#6A5ACD',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 15,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingLabel: {
    fontSize: 16,
    color: '#444',
  },
  timeInput: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6A5ACD',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 80,
    textAlign: 'center',
  },
  lastUpdateRow: {
    marginTop: 15,
    marginBottom: 5,
  },
  lastUpdateText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  appIconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f1f1f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  appIconText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#666',
  },
  appInfo: {
    flex: 1,
    marginLeft: 12,
  },
  appName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  appCategory: {
    fontSize: 13,
    color: '#888',
  },
  appTime: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6A5ACD',
  },
  contactItem: {
    flexDirection: 'row',
    padding: 15,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  selectedContact: {
    backgroundColor: '#f0f0ff',
    borderColor: '#6A5ACD',
    borderWidth: 1,
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  contactInitial: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#555',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  contactPhone: {
    fontSize: 14,
    color: '#777',
  },
  checkmark: {
    marginLeft: 10,
  },
  selectedPartnersText: {
    textAlign: 'center',
    marginTop: 10,
    fontSize: 14,
    color: '#666',
  },
  goalPickerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 20,
  },
  goalPickerSection: {
    alignItems: 'center',
  },
  goalPickerLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  goalPickerControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalButton: {
    backgroundColor: '#f0f0f0',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalPickerValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginHorizontal: 15,
    minWidth: 30,
    textAlign: 'center',
  },
});
