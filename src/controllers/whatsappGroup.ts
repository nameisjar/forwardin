import { Request, Response } from 'express';
import { WhatsAppGroupService } from '../services/whatsappGroup';
import prisma from '../utils/db';

export const getActiveGroups = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params; // This is UUID from URL
    
    if (!deviceId) {
      return res.status(400).json({
        status: false,
        message: 'Device ID is required',
      });
    }

    console.log('Getting active groups for device UUID:', deviceId);

    // Get device info using UUID to get pkId and sessionId
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        sessions: {
          where: { id: { contains: 'config' } },
          select: { sessionId: true }
        }
      }
    });

    if (!device) {
      console.error(`Device not found with UUID: ${deviceId}`);
      return res.status(404).json({
        status: false,
        message: 'Device not found',
      });
    }

    // Use device.pkId for database operations
    const groups = await WhatsAppGroupService.getActiveGroups(device.pkId);
    
    console.log(`Found ${groups.length} active groups for device: ${device.name}`);
    
    // Get WhatsApp instance to fetch profile pictures
    let instance: any = null;
    try {
      const sessionId = device.sessions[0]?.sessionId;
      if (sessionId) {
        const { getInstance, verifyInstance } = require('../whatsapp');
        if (verifyInstance(sessionId)) {
          instance = getInstance(sessionId);
          console.log('WhatsApp instance available, will fetch group profile pictures');
        } else {
          console.log('WhatsApp instance not available, returning groups without profile pictures');
        }
      }
    } catch (error) {
      console.log('Could not get WhatsApp instance:', error);
    }
    
    // Transform data and fetch profile pictures if instance is available
    const transformedGroupsPromises = groups.map(async (group) => {
      let profilePicUrl: string | null = null;
      
      // Try to fetch profile picture if instance is available
      if (instance) {
        try {
          profilePicUrl = await instance.profilePictureUrl(group.groupId, 'image');
          console.log(`Fetched profile picture for group: ${group.groupName}`);
        } catch (error) {
          // Group might not have a profile picture, or other error - just skip
          console.log(`No profile picture for group ${group.groupName}:`, (error as any)?.message || 'Unknown error');
        }
      }
      
      return {
        id: group.groupId, // ✅ Use WhatsApp JID as ID
        groupId: group.groupId, // Keep groupId for reference
        name: group.groupName,
        subject: group.groupName, // Alias for compatibility
        participants: group.participants,
        profilePicUrl: profilePicUrl, // ✅ Add profile picture URL
        isActive: group.isActive,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      };
    });
    
    const transformedGroups = await Promise.all(transformedGroupsPromises);
    
    res.json({
      status: true,
      data: transformedGroups,
    });
  } catch (error) {
    console.error('Error getting active groups:', error);
    res.status(500).json({
      status: false,
      message: 'Internal server error',
      error: (error as any)?.message || 'Unknown error'
    });
  }
};

export const getAllGroups = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params; // This is UUID from URL
    
    if (!deviceId) {
      return res.status(400).json({
        status: false,
        message: 'Device ID is required',
      });
    }

    // Get device info using UUID to get pkId
    const device = await prisma.device.findUnique({
      where: { id: deviceId }
    });

    if (!device) {
      return res.status(404).json({
        status: false,
        message: 'Device not found',
      });
    }

    const groups = await WhatsAppGroupService.getAllGroups(device.pkId);
    
    res.json({
      status: true,
      data: groups,
    });
  } catch (error) {
    console.error('Error getting all groups:', error);
    res.status(500).json({
      status: false,
      message: 'Internal server error',
    });
  }
};

export const searchGroups = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params; // This is UUID from URL
    const { search } = req.query;
    
    if (!deviceId) {
      return res.status(400).json({
        status: false,
        message: 'Device ID is required',
      });
    }

    if (!search || typeof search !== 'string') {
      return res.status(400).json({
        status: false,
        message: 'Search term is required',
      });
    }

    // Get device info using UUID to get pkId
    const device = await prisma.device.findUnique({
      where: { id: deviceId }
    });

    if (!device) {
      return res.status(404).json({
        status: false,
        message: 'Device not found',
      });
    }

    const groups = await WhatsAppGroupService.searchGroups(device.pkId, search);
    
    res.json({
      status: true,
      data: groups,
    });
  } catch (error) {
    console.error('Error searching groups:', error);
    res.status(500).json({
      status: false,
      message: 'Internal server error',
    });
  }
};

export const updateGroupStatus = async (req: Request, res: Response) => {
  try {
    const { deviceId, groupId } = req.params;
    const { isActive } = req.body;
    
    if (!deviceId || !groupId) {
      return res.status(400).json({
        status: false,
        message: 'Device ID and Group ID are required',
      });
    }

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        status: false,
        message: 'isActive must be a boolean',
      });
    }

    await WhatsAppGroupService.updateGroupStatus(groupId, parseInt(deviceId), isActive);
    
    res.json({
      status: true,
      message: 'Group status updated successfully',
    });
  } catch (error) {
    console.error('Error updating group status:', error);
    res.status(500).json({
      status: false,
      message: 'Internal server error',
    });
  }
};

export const deleteGroup = async (req: Request, res: Response) => {
  try {
    const { deviceId, groupId } = req.params;
    
    if (!deviceId || !groupId) {
      return res.status(400).json({
        status: false,
        message: 'Device ID and Group ID are required',
      });
    }

    await WhatsAppGroupService.deleteGroup(groupId, parseInt(deviceId));
    
    res.json({
      status: true,
      message: 'Group deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({
      status: false,
      message: 'Internal server error',
    });
  }
};

export const syncGroups = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params; // This is UUID from URL
    
    if (!deviceId) {
      return res.status(400).json({
        status: false,
        message: 'Device ID is required',
      });
    }

    console.log('Syncing groups for device UUID:', deviceId);
    
    // Get device info using UUID (not pkId) and include sessions
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        sessions: {
          where: { id: { contains: 'config' } },
          select: { sessionId: true }
        }
      }
    });

    if (!device) {
      console.error(`Device not found with UUID: ${deviceId}`);
      return res.status(404).json({
        status: false,
        message: 'Device not found',
      });
    }

    console.log('Found device:', device.name, 'Status:', device.status);

    if (device.status !== 'open') {
      return res.status(400).json({
        status: false,
        message: 'WhatsApp is not connected. Please connect WhatsApp first.',
      });
    }

    // Get sessionId from device
    const sessionId = device.sessions[0]?.sessionId;
    if (!sessionId) {
      console.error('No session found for device:', deviceId);
      return res.status(400).json({
        status: false,
        message: 'No active session found. Please reconnect WhatsApp.',
      });
    }

    console.log('Session ID found:', sessionId);

    // Use existing WhatsApp instance functions
    const { getInstance, verifyInstance } = require('../whatsapp');
    
    // Verify instance using sessionId (not deviceId)
    if (!verifyInstance(sessionId)) {
      console.error(`WhatsApp session not found for sessionId: ${sessionId}`);
      return res.status(400).json({
        status: false,
        message: 'WhatsApp session not found. Please reconnect WhatsApp.',
      });
    }

    const instance = getInstance(sessionId);
    
    try {
      console.log('Fetching groups from WhatsApp...');
      
      // Get groups from WhatsApp
      const groupsData = await instance.groupFetchAllParticipating();
      const groupsArray = Object.values(groupsData).map((group: any) => ({
        id: group.id,
        subject: group.subject,
        participants: group.participants || [], // Send as array instead of count
      }));

      console.log(`Found ${groupsArray.length} groups for device ${deviceId}`);

      // Save groups to database using device pkId
      // ✅ replaceAll = true karena ini adalah MANUAL SYNC (user klik tombol sync)
      const result = await WhatsAppGroupService.saveWhatsAppGroups(
        device.pkId, // Use device.pkId for database operations
        sessionId, // Use sessionId (not deviceId)
        groupsArray,
        true // Replace all existing groups
      );

      console.log('Groups saved to database successfully');

      res.json({
        status: true,
        message: `Successfully synced ${groupsArray.length} groups`,
        data: {
          synced: groupsArray.length,
          deviceName: device.name,
          ...result
        }
      });

    } catch (whatsappError) {
      console.error('Error fetching groups from WhatsApp:', whatsappError);
      res.status(500).json({
        status: false,
        message: 'Failed to fetch groups from WhatsApp. Make sure WhatsApp is properly connected.',
        error: (whatsappError as any)?.message || 'Unknown WhatsApp error'
      });
    }

  } catch (error) {
    console.error('Error syncing groups:', error);
    res.status(500).json({
      status: false,
      message: 'Internal server error',
      error: (error as any)?.message || 'Unknown error'
    });
  }
};

export const joinGroup = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    const { inviteLink } = req.body;
    
    console.log('=== JOIN GROUP REQUEST ===');
    console.log('Device UUID:', deviceId);
    console.log('Invite Link:', inviteLink);
    console.log('Request body:', req.body);
    
    if (!deviceId) {
      return res.status(400).json({
        status: false,
        message: 'Device ID is required',
      });
    }

    if (!inviteLink || typeof inviteLink !== 'string') {
      return res.status(400).json({
        status: false,
        message: 'Invite link is required',
      });
    }

    console.log('Step 1: Finding device in database...');
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        sessions: {
          where: { id: { contains: 'config' } },
          select: { sessionId: true }
        }
      }
    });

    if (!device) {
      console.error('Device not found with UUID:', deviceId);
      return res.status(404).json({
        status: false,
        message: 'Device not found',
      });
    }

    console.log('Device found:', {
      id: device.id,
      name: device.name,
      status: device.status,
      pkId: device.pkId,
      sessions: device.sessions
    });

    if (device.status !== 'open') {
      console.error('Device status is not open:', device.status);
      return res.status(400).json({
        status: false,
        message: `WhatsApp is not connected. Current status: ${device.status}. Please connect WhatsApp first.`,
      });
    }

    // Get sessionId from device
    const sessionId = device.sessions[0]?.sessionId;
    if (!sessionId) {
      console.error('No session found for device:', deviceId);
      return res.status(400).json({
        status: false,
        message: 'No active session found. Please reconnect WhatsApp.',
      });
    }

    console.log('Session ID found:', sessionId);

    console.log('Step 2: Verifying WhatsApp instance...');
    const { getInstance, verifyInstance } = require('../whatsapp');
    
    const isInstanceValid = verifyInstance(sessionId);
    console.log('Instance verification result:', isInstanceValid);
    
    if (!isInstanceValid) {
      console.error('WhatsApp session not found for sessionId:', sessionId);
      
      return res.status(400).json({
        status: false,
        message: 'WhatsApp session not found. Please reconnect WhatsApp. Make sure the device is properly connected and the session is active.',
      });
    }

    console.log('Step 3: Getting WhatsApp instance...');
    const instance = getInstance(sessionId);
    console.log('Instance retrieved successfully');
    
    try {
      // Extract invite code from link
      console.log('Step 4: Extracting invite code...');
      const inviteCode = inviteLink.split('/').pop()?.replace(/\?.*$/, '') || '';
      
      if (!inviteCode) {
        console.error('Invalid invite code extracted from link:', inviteLink);
        return res.status(400).json({
          status: false,
          message: 'Invalid invite link format',
        });
      }

      console.log('Invite code extracted:', inviteCode);
      console.log('Step 5: Attempting to join group...');
      
      // Join group using Baileys
      const result = await instance.groupAcceptInvite(inviteCode);
      
      console.log('Successfully joined group! Result:', result);

      console.log('Step 6: Syncing groups to database...');
      // Sync groups to update database
      const groupsData = await instance.groupFetchAllParticipating();
      const groupsArray = Object.values(groupsData).map((group: any) => ({
        id: group.id,
        subject: group.subject,
        participants: group.participants || [],
      }));

      console.log(`Fetched ${groupsArray.length} groups from WhatsApp`);

      await WhatsAppGroupService.saveWhatsAppGroups(
        device.pkId,
        sessionId,
        groupsArray,
        true
      );

      console.log('Groups synced successfully');
      console.log('=== JOIN GROUP SUCCESS ===');

      res.json({
        status: true,
        message: 'Successfully joined group',
        data: { groupId: result }
      });

    } catch (whatsappError: any) {
      console.error('=== WHATSAPP ERROR ===');
      console.error('Error joining group:', whatsappError);
      console.error('Error message:', whatsappError?.message);
      console.error('Error stack:', whatsappError?.stack);
      
      res.status(500).json({
        status: false,
        message: whatsappError?.message || 'Failed to join group. Please make sure the invite link is valid and not expired.',
      });
    }

  } catch (error: any) {
    console.error('=== GENERAL ERROR ===');
    console.error('Error joining group:', error);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    
    res.status(500).json({
      status: false,
      message: 'Internal server error',
      error: error?.message || 'Unknown error'
    });
  }
};

export const leaveGroup = async (req: Request, res: Response) => {
  try {
    const { deviceId, groupJid } = req.params;
    
    console.log('=== LEAVE GROUP REQUEST ===');
    console.log('Device UUID:', deviceId);
    console.log('Group JID:', groupJid);
    
    if (!deviceId || !groupJid) {
      return res.status(400).json({
        status: false,
        message: 'Device ID and Group JID are required',
      });
    }
    
    console.log('Step 1: Finding device in database...');
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        sessions: {
          where: { id: { contains: 'config' } },
          select: { sessionId: true }
        }
      }
    });

    if (!device) {
      console.error('Device not found with UUID:', deviceId);
      return res.status(404).json({
        status: false,
        message: 'Device not found',
      });
    }

    console.log('Device found:', {
      id: device.id,
      name: device.name,
      status: device.status,
      pkId: device.pkId,
      sessions: device.sessions
    });

    if (device.status !== 'open') {
      console.error('Device status is not open:', device.status);
      return res.status(400).json({
        status: false,
        message: `WhatsApp is not connected. Current status: ${device.status}. Please connect WhatsApp first.`,
      });
    }

    // Get sessionId from device
    const sessionId = device.sessions[0]?.sessionId;
    if (!sessionId) {
      console.error('No session found for device:', deviceId);
      return res.status(400).json({
        status: false,
        message: 'No active session found. Please reconnect WhatsApp.',
      });
    }

    console.log('Session ID found:', sessionId);

    console.log('Step 2: Verifying WhatsApp instance...');
    const { getInstance, verifyInstance } = require('../whatsapp');
    
    if (!verifyInstance(sessionId)) {
      console.error('WhatsApp session not found for sessionId:', sessionId);
      return res.status(400).json({
        status: false,
        message: 'WhatsApp session not found. Please reconnect WhatsApp.',
      });
    }

    console.log('Step 3: Getting WhatsApp instance...');
    const instance = getInstance(sessionId);
    console.log('Instance retrieved successfully');
    
    try {
      console.log('Step 4: Checking if group exists...');
      // Verify we're still in the group before trying to leave
      try {
        const groupMetadata = await instance.groupMetadata(groupJid);
        console.log('Group metadata:', {
          id: groupMetadata.id,
          subject: groupMetadata.subject,
          participants: groupMetadata.participants?.length || 0
        });
      } catch (metadataError: any) {
        console.error('Cannot fetch group metadata:', metadataError.message);
        
        // If we can't fetch metadata, we're probably not in the group anymore
        if (metadataError?.output?.statusCode === 404 || 
            metadataError?.message?.includes('not-authorized') ||
            metadataError?.message?.includes('forbidden')) {
          console.log('Already not in group, cleaning up database...');
          
          await prisma.whatsAppGroup.deleteMany({
            where: {
              groupId: groupJid,
              deviceId: device.pkId,
            }
          });
          
          return res.json({
            status: true,
            message: 'You are already not in this group. Database cleaned up.',
          });
        }
      }
      
      console.log('Step 5: Leaving group via WhatsApp...');
      
      // Leave group using Baileys
      await instance.groupLeave(groupJid);
      
      console.log('Successfully sent leave request to WhatsApp');
      
      // Wait a bit for WhatsApp to process
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log('Step 6: Verifying we left the group...');
      // Verify we actually left
      try {
        await instance.groupMetadata(groupJid);
        // If we can still fetch metadata, we might not have left successfully
        console.warn('Warning: Still able to fetch group metadata after leave. Might still be in group.');
      } catch (verifyError: any) {
        if (verifyError?.output?.statusCode === 404 || 
            verifyError?.message?.includes('not-authorized') ||
            verifyError?.message?.includes('forbidden')) {
          console.log('Verified: Successfully left the group (cannot access metadata anymore)');
        } else {
          console.error('Unexpected error verifying leave:', verifyError.message);
        }
      }

      console.log('Step 7: Removing from database...');
      // Remove from database
      const deleteResult = await prisma.whatsAppGroup.deleteMany({
        where: {
          groupId: groupJid,
          deviceId: device.pkId,
        }
      });

      console.log(`Deleted ${deleteResult.count} group record(s) from database`);

      console.log('Step 8: Syncing remaining groups...');
      // Sync groups to ensure database is up to date
      try {
        const groupsData = await instance.groupFetchAllParticipating();
        const groupsArray = Object.values(groupsData).map((group: any) => ({
          id: group.id,
          subject: group.subject,
          participants: group.participants || [],
        }));

        console.log(`Fetched ${groupsArray.length} remaining groups from WhatsApp`);

        await WhatsAppGroupService.saveWhatsAppGroups(
          device.pkId,
          sessionId,
          groupsArray,
          true // Replace all to ensure sync
        );

        console.log('Groups synced successfully after leave');
      } catch (syncError) {
        console.error('Error syncing groups after leave:', syncError);
        // Don't fail the request if sync fails
      }

      console.log('=== LEAVE GROUP SUCCESS ===');

      res.json({
        status: true,
        message: 'Successfully left group',
      });

    } catch (whatsappError: any) {
      console.error('=== WHATSAPP ERROR ===');
      console.error('Error leaving group:', whatsappError);
      console.error('Error message:', whatsappError?.message);
      console.error('Error stack:', whatsappError?.stack);
      console.error('Error output:', whatsappError?.output);
      
      // Check if error is because we're not in the group
      if (whatsappError?.output?.statusCode === 403 ||
          whatsappError?.message?.includes('not-authorized') ||
          whatsappError?.message?.includes('forbidden') ||
          whatsappError?.message?.includes('not a participant')) {
        
        console.log('Not in group, cleaning up database...');
        
        await prisma.whatsAppGroup.deleteMany({
          where: {
            groupId: groupJid,
            deviceId: device.pkId,
          }
        });
        
        return res.json({
          status: true,
          message: 'You are not in this group anymore. Database cleaned up.',
        });
      }
      
      res.status(500).json({
        status: false,
        message: whatsappError?.message || 'Failed to leave group. Please try again or check if you are still in the group.',
      });
    }

  } catch (error: any) {
    console.error('=== GENERAL ERROR ===');
    console.error('Error leaving group:', error);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    
    res.status(500).json({
      status: false,
      message: 'Internal server error',
      error: error?.message || 'Unknown error'
    });
  }
};