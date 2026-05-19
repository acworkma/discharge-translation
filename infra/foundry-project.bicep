// Cross-RG module: declares the prj-discharge Foundry project under the
// existing foundry-acw Foundry account (provisioned out-of-band in rg-foundry)
// and grants the workload UAMI the Azure AI User data-plane role on it.
//
// Scope: rg-foundry (cross-RG from rg-discharge). Invoked from main.bicep
// with `scope: resourceGroup('rg-foundry')`.
//
// Phase 1 of feat/foundry-demo. Idempotent: re-declaring the project with the
// same name is a no-op once it exists.

targetScope = 'resourceGroup'

@description('Foundry account name (existing, in this RG)')
param foundryAccountName string = 'foundry-acw'

@description('Project location. Must match the account location (eastus2).')
param location string = 'eastus2'

@description('Project name to create under the account')
param projectName string = 'prj-discharge'

@description('Display name shown in the Foundry portal')
param projectDisplayName string = 'Discharge Translation Demo'

@description('Project description')
param projectDescription string = 'HoK Foundry demo: per-LLM prompt agents, CTQS evaluators, consensus orchestrator. Branch: feat/foundry-demo.'

@description('Workload UAMI principalId from the discharge resource group — granted Azure AI User on the project')
param workloadUamiPrincipalId string

@description('Whether this module should manage the workload UAMI -> Azure AI User role assignment on the project. Default true. Set to false if RBAC is managed out-of-band (e.g. via the Foundry portal or another deployment) to keep this template idempotent.')
param manageProjectRbac bool = true

resource account 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' existing = {
  name: foundryAccountName
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: account
  name: projectName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: projectDisplayName
    description: projectDescription
  }
}

// Azure AI User — data-plane role for inference + agents on a Foundry project.
// (Foundry portal renders this as "Foundry User".)
var azureAiUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

// Deterministic name. Bicep `guid()` is stable across deployments, so a
// re-deploy that finds an assignment with the same name at the same scope
// is a no-op. ARM still raises RoleAssignmentExists if a different role
// assignment for the same (principal, role, scope) tuple exists under a
// DIFFERENT name (e.g. created out-of-band by the Foundry portal or an MCP
// tool). When that's the case, set manageProjectRbac=false on re-deploy or
// delete the orphan first:
//   az role assignment delete --scope <projectId> --assignee <uamiPid> \
//                             --role 53ca6127-db72-4b80-b1b0-d745d6d5456d
resource raWorkloadAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageProjectRbac) {
  scope: project
  name: guid(project.id, workloadUamiPrincipalId, azureAiUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', azureAiUserRoleId)
    principalId: workloadUamiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output projectEndpoint string = project.properties.endpoints['AI Foundry API']
output projectResourceId string = project.id
output projectPrincipalId string = project.identity.principalId
