import { defineMethod, type RpcMethod } from '../core'
// Direct module import (clipboard.ts precedent): the attachment flow keeps its
// own state in the plane module, so the runtime facade adds no indirection.
import {
  listWorkItemAttachments,
  uploadWorkItemAttachment
} from '../../../plane/plane-work-item-attachments'
import {
  AddLink,
  AddRelation,
  CreateLabel,
  DeleteLink,
  ProjectWorkItem,
  UploadAttachment
} from './plane-extended-schemas'

// Extended Plane RPC methods (delete, relations, links, label create).
// Concatenated into PLANE_METHODS by plane.ts so the base method table stays
// under the per-file line cap.
export const PLANE_EXTENDED_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'plane.deleteWorkItem',
    params: ProjectWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeDeleteWorkItem({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.addWorkItemRelation',
    params: AddRelation,
    handler: async (params, { runtime }) =>
      runtime.planeAddWorkItemRelation({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        relationType: params.relationType,
        relatedWorkItemId: params.relatedWorkItemId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.listWorkItemRelations',
    params: ProjectWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeListWorkItemRelations({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.addWorkItemLink',
    params: AddLink,
    handler: async (params, { runtime }) =>
      runtime.planeAddWorkItemLink({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        url: params.url.trim(),
        title: params.title,
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.deleteWorkItemLink',
    params: DeleteLink,
    handler: async (params, { runtime }) =>
      runtime.planeDeleteWorkItemLink({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        linkId: params.linkId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.listWorkItemLinks',
    params: ProjectWorkItem,
    handler: async (params, { runtime }) =>
      runtime.planeListWorkItemLinks({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.uploadWorkItemAttachment',
    params: UploadAttachment,
    handler: async (params) =>
      uploadWorkItemAttachment({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        filePath: params.filePath.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.listWorkItemAttachments',
    params: ProjectWorkItem,
    handler: async (params) =>
      listWorkItemAttachments({
        projectId: params.projectId.trim(),
        workItemId: params.workItemId.trim(),
        workspaceId: params.workspaceId
      })
  }),
  defineMethod({
    name: 'plane.createLabel',
    params: CreateLabel,
    handler: async (params, { runtime }) =>
      runtime.planeCreateLabel({
        projectId: params.projectId.trim(),
        name: params.name.trim(),
        color: params.color,
        workspaceId: params.workspaceId
      })
  })
]
