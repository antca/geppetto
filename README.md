# Geppetto

Welcome to Geppetto! Geppetto is a personal assistant AI that is designed to
help you with your daily tasks. With Geppetto, you can ask questions, execute
commands, and perform other tasks quickly and easily. In this README file,
you'll find everything you need to know to get started with Geppetto.

## Disclaimer

This project is just a little experiment to see what would be possible to do by
extending the capabilities of ChatGPT with a docker container running a complete
Linux system. Don't take it too seriously as, from my experience using it, it
may feel a bit unstable: Sometimes it works like magic on advanced requests,
sometimes it crashes in a loop on basic stuff.

This app relies on the ChatGPT API used by the official app itself, it not
officially supported and may break at any time.

When the app is started, it creates a new conversation that is visible in the
ChatGPT UI. They are currently not cleaned automatically, so expect some
clutter.

Use it at your own risk.

## Installation

To install Geppetto, you must first clone this repository. To do so, run the
following command:

```
$ git clone https://github.com/antca/geppetto.git
```

Next, navigate to the repository folder and install the necessary dependencies.
To do so, run the following command:

```
$ cd geppetto
$ docker compose build
```

To authenticate the app, you need to create a file named `.env` at the root of
the cloned repository to store the authentication credentials. There are two
ways to authenticate the app:

1. Using `OPENAI_API_KEY`: You can generate an API key by visiting
   https://platform.openai.com/account/api-keys.
2. Using `CHAT_GPT_COOKIE` and `CHAT_GPT_USER_AGENT`: To find them, open the
   browser's developer tools while authenticated on https://chat.openai.com, and
   examine the headers of a request. Copy the values of the Cookie and
   User-Agent headers, which will then be sent directly to the ChatGPT API.

It's important to keep the `.env` file secure since it contains sensitive
information.

## Usage

To use Geppetto, simply run the following command:

```
$ docker compose run --rm geppetto
```

This will start the Geppetto program, and you can begin interacting with the AI
immediately.

The `workspace` directory is the default current directory used by Geppetto when
it executes commands. It can be used to give access to some files to Geppetto or
to collect created ones.

You can put some hints in the file `.hints.txt` inside the `workspace` directory
for ChatGPT, they will be added to the initial prompt. This can be useful to
have some initial context. For example, you can add some documentation about
custom scripts.

## Example

Here is a little conversation that went well as an example. Use your imagination
to do something more useful.

[![asciicast](https://asciinema.org/a/q4aexDEfHEHqK8Kdd6rPmr6ln.svg)](https://asciinema.org/a/q4aexDEfHEHqK8Kdd6rPmr6ln)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.
