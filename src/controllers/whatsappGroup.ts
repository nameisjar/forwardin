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

    // Get device info using UUID to get pkId
    const device = await prisma.device.findUnique({
      where: { id: deviceId }
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
    
    res.json({
      status: true,
      data: groups,
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
    
    // Get device info using UUID (not pkId)
    const device = await prisma.device.findUnique({
      where: { id: deviceId } // Use id field for UUID lookup
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

    // Use existing WhatsApp instance functions
    const { getInstance, verifyInstance } = require('../whatsapp');
    
    // Verify instance using device UUID (not pkId)
    if (!verifyInstance(deviceId)) {
      console.error(`WhatsApp session not found for device: ${deviceId}`);
      return res.status(400).json({
        status: false,
        message: 'WhatsApp session not found. Please reconnect WhatsApp.',
      });
    }

    const instance = getInstance(deviceId);
    
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
      const result = await WhatsAppGroupService.saveWhatsAppGroups(
        device.pkId, // Use device.pkId for database operations
        deviceId, // Use deviceId (UUID) as sessionId
        groupsArray
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