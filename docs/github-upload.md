# Upload V1 to a private GitHub repository using a token

Checked: **21 October 2026**. Run these commands from the existing project
checkout in your local terminal. The code is already committed on `master`;
initializing Git again is unnecessary.

## Create the destination and token

1. On GitHub, create a **private** repository named **learning-management-system** under your account.
   Leave README, licence and `.gitignore` initialization unchecked: those files
   are already in this project. See GitHub's
   [existing-repository upload instructions](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).
2. Create a fine-grained personal access token with your account as resource owner,
   access to **only this repository**, an expiration, and repository permissions
   **Contents: Read and write** and **Workflows: Read and write**. The latter is
   needed because this upload includes `.github/workflows/release-check.yml`.
   See [token setup](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
   and [workflow permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

## Connect and push

Replace `YOUR_USERNAME` with the repository owner's GitHub username. These
commands assume `git remote -v` shows no existing remote.

```sh
git remote add origin https://github.com/YOUR_USERNAME/learning-management-system.git
git -c credential.helper= -c core.askPass= push -u origin master
```

At the prompts, enter your GitHub username, then paste the token as the
**password**. The token is not displayed while entering it. GitHub documents
[using a token in place of a password](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#using-a-personal-access-token-on-the-command-line).

The empty helper setting bypasses saved credentials for this one command and
does not save the new token through a credential helper. It does not change your
global Git configuration. See [Git's credential configuration](https://git-scm.com/docs/gitcredentials).
Keep the token out of the remote URL, command text, source files and chat.

If a terminal integration launches another authentication window, use this
macOS/Linux command to request terminal input explicitly:

```sh
env -u GIT_ASKPASS -u SSH_ASKPASS GIT_TERMINAL_PROMPT=1 \
  git -c credential.helper= -c core.askPass= push -u origin master
```

## Confirm the upload

After the push succeeds, open the private repository and check that its latest
commit matches `git rev-parse HEAD`. In **Actions**, inspect the **Release checks**
run triggered by the push. The repository workflow runs dependency audits in
addition to local release checks; an upload alone does not establish that CI
passed or deploy the application.

| Problem | Next action |
| --- | --- |
| `remote origin already exists` | Inspect `git remote -v`. If the URL is wrong, use `git remote set-url origin https://github.com/YOUR_USERNAME/learning-management-system.git`. |
| Authentication failure or repository not found | Check the owner/name, token expiry, selected repository and account access; use the token at the password prompt. |
| Workflow permission rejected | Add Workflows write permission to the token and repeat the push. |
| Push rejected because the remote has commits | Inspect the remote history before merging; this first-upload procedure assumes an empty repository. Do not force-push over work you intend to keep. |

## Preserve the cleanup

Push from the sanitized app checkout. The separate private recovery directory
contains old history and must stay outside the upload. See
[repository privacy](./repository-privacy.md) for the retained credits, functional
IDs and sharing scope. GitHub account ownership remains visible to people with
repository access even though the local commit authors were anonymized.

To refresh a source-only archive after later committed changes:

```sh
git archive --format=zip --prefix=learning-management-system/ --output=../learning-management-system-v1-sanitized.zip HEAD
```

That archive is useful for handing over source files. Use the Git push above when
you want the repository's sanitized commit history on GitHub.
