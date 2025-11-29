import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface WhatsAppGroupData {
  id: string;
  subject?: string;
  name?: string;
  participants?: any[];
}

export class WhatsAppGroupService {
  /**
   * Menyimpan atau update grup WhatsApp saat device terhubung
   * @param deviceId - ID device
   * @param sessionId - Session ID
   * @param groups - Array of groups to save/update
   * @param replaceAll - Jika true, nonaktifkan semua grup lama sebelum save. Jika false, hanya update/tambah grup yang di-pass
   */
  static async saveWhatsAppGroups(
    deviceId: number,
    sessionId: string,
    groups: WhatsAppGroupData[],
    replaceAll: boolean = false
  ) {
    try {
      // ✅ HANYA nonaktifkan grup lama jika replaceAll = true (saat full sync)
      // ❌ JANGAN nonaktifkan jika hanya menambah grup baru (saat groups.upsert event)
      if (replaceAll) {
        await prisma.whatsAppGroup.updateMany({
          where: {
            deviceId: deviceId,
          },
          data: {
            isActive: false,
          },
        });
        console.log(`[saveWhatsAppGroups] Replace mode: deactivated all old groups for device ${deviceId}`);
      }

      // Simpan atau update grup baru
      for (const group of groups) {
        await prisma.whatsAppGroup.upsert({
          where: {
            groupId_deviceId: {
              groupId: group.id,
              deviceId: deviceId,
            },
          },
          update: {
            groupName: group.subject || group.name || 'Unknown Group',
            participants: group.participants?.length || 0,
            isActive: true,
            sessionId: sessionId,
            updatedAt: new Date(),
          },
          create: {
            groupId: group.id,
            groupName: group.subject || group.name || 'Unknown Group',
            participants: group.participants?.length || 0,
            sessionId: sessionId,
            deviceId: deviceId,
            isActive: true,
          },
        });
      }

      const mode = replaceAll ? 'replaced' : 'added/updated';
      console.log(`[saveWhatsAppGroups] ${mode} ${groups.length} groups for device ${deviceId}`);
      return { success: true, count: groups.length };
    } catch (error) {
      console.error('Error saving WhatsApp groups:', error);
      throw error;
    }
  }

  /**
   * Menghapus/nonaktifkan grup saat session terputus
   */
  static async clearWhatsAppGroups(deviceId: number, sessionId?: string) {
    try {
      const whereClause: any = { deviceId: deviceId };
      if (sessionId) {
        whereClause.sessionId = sessionId;
      }

      await prisma.whatsAppGroup.updateMany({
        where: whereClause,
        data: {
          isActive: false,
        },
      });

      console.log(`Cleared groups for device ${deviceId}${sessionId ? `, session ${sessionId}` : ''}`);
      return { success: true };
    } catch (error) {
      console.error('Error clearing WhatsApp groups:', error);
      throw error;
    }
  }

  /**
   * Mengambil grup aktif untuk broadcast
   */
  static async getActiveGroups(deviceId: number) {
    try {
      const groups = await prisma.whatsAppGroup.findMany({
        where: {
          deviceId: deviceId,
          isActive: true,
        },
        orderBy: {
          groupName: 'asc',
        },
      });

      return groups;
    } catch (error) {
      console.error('Error fetching active groups:', error);
      return [];
    }
  }

  /**
   * Mengambil semua grup (aktif dan tidak aktif) untuk device
   */
  static async getAllGroups(deviceId: number) {
    try {
      const groups = await prisma.whatsAppGroup.findMany({
        where: {
          deviceId: deviceId,
        },
        orderBy: [
          { isActive: 'desc' },
          { groupName: 'asc' },
        ],
      });

      return groups;
    } catch (error) {
      console.error('Error fetching all groups:', error);
      return [];
    }
  }

  /**
   * Mengupdate status grup tertentu
   */
  static async updateGroupStatus(groupId: string, deviceId: number, isActive: boolean) {
    try {
      await prisma.whatsAppGroup.updateMany({
        where: {
          groupId: groupId,
          deviceId: deviceId,
        },
        data: {
          isActive: isActive,
          updatedAt: new Date(),
        },
      });

      return { success: true };
    } catch (error) {
      console.error('Error updating group status:', error);
      throw error;
    }
  }

  /**
   * Menghapus grup secara permanen dari database
   */
  static async deleteGroup(groupId: string, deviceId: number) {
    try {
      await prisma.whatsAppGroup.deleteMany({
        where: {
          groupId: groupId,
          deviceId: deviceId,
        },
      });

      return { success: true };
    } catch (error) {
      console.error('Error deleting group:', error);
      throw error;
    }
  }

  /**
   * Mencari grup berdasarkan nama
   */
  static async searchGroups(deviceId: number, searchTerm: string) {
    try {
      const groups = await prisma.whatsAppGroup.findMany({
        where: {
          deviceId: deviceId,
          isActive: true,
          groupName: {
            contains: searchTerm,
            mode: 'insensitive',
          },
        },
        orderBy: {
          groupName: 'asc',
        },
      });

      return groups;
    } catch (error) {
      console.error('Error searching groups:', error);
      return [];
    }
  }
}