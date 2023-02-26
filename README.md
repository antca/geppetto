# Geppetto

Welcome to Geppetto! Geppetto is a personal assistant AI that is designed to help you with your daily tasks. With Geppetto, you can ask questions, execute commands, and perform other tasks quickly and easily. In this README file, you'll find everything you need to know to get started with Geppetto.

## Disclaimer

This project is just a little experiment to see what would be possible to do by extending the capabilities of ChatGPT with a docker container running a complete Linux system.
Don't take it too seriously as, from my experience using it, it may feel a bit unstable: Sometimes it works like magic on advanced requests, sometimes it crashes in a loop on basic stuff.

This app relies on the ChatGPT API used by the official app itself, it not officially supported and may break at any time.

When the app is started, it creates a new conversation that is visible in the ChatGPT UI. They are currently not cleaned automatically, so expect some clutter.

Use it at your own risk.

## Installation

To install Geppetto, you must first clone this repository. To do so, run the following command:

```
$ git clone https://github.com/antca/geppetto.git
```

Next, navigate to the repository folder and install the necessary dependencies. To do so, run the following command:

```
$ cd geppetto
$ docker compose build
```

Once the project is build, you must create a file `.chat_gpt_cookie.txt` containing your ChatGPT cookie at the root of cloned repository.
You can find this cookie in the browser inspector by looking at the headers of a request and copy the `Cookie` header value. The cookie header value is sent as is to the ChatGPT API.
Currently this is the only simple way to authenticate the app to make Geppetto work.

## Usage

To use Geppetto, simply run the following command:

```
$ docker compose run geppetto
```

This will start the Geppetto program, and you can begin interacting with the AI immediately.

The `workspace` directory is the default current directory used by Geppetto when it executes commands.
It can be used to give access to some files to Geppetto or to collect created ones.

## Example

Here is a little conversation that went well as an example. Use your imagination to do something more useful (the debug logs have been removed).

```
Geppetto: Hello, I'm Geppetto, your personal assistant. How can I assist you today?
You: What time is it?
Geppetto: The current time is 12:29:26 PM UTC.
You: I would prefer the time with my timezone, I am in brussels.
Geppetto: The current time in Brussels is 01:30:05 PM CET.
You: Is is possible for you to upload a file on the internet?
Geppetto: Yes, it is possible. Do you have a file ready to upload, or do you need assistance in generating one?
You: First, create a file foo.txt with the content "Hello, World!"
Geppetto: File 'foo.txt' has been created with the text 'Hello, World!'.
You: Can you put this file on the internet?
Geppetto: Yes, I can upload the file to a file hosting service. Which file hosting service do you prefer?
You: I don't know, is there any not requiring authentication?
Geppetto: Yes, there are a few file hosting services that do not require authentication. For example, you can use transfer.sh. Do you want me to upload the file to this service?
You: Yes please
Geppetto: The file has been uploaded to transfer.sh. You can download it using the following link: https://transfer.sh/[REDACTED]/foo.txt.
You: Can you upload another file containing a joke?
Geppetto: I created a file containing a random dad joke. It has been saved as 'dadjoke.txt'. Do you want me to read the joke to you?
You: Put it online please
Geppetto: The dad joke file has been uploaded to transfer.sh. You can download it using the following link: https://transfer.sh/[REDACTED]/dadjoke.txt.
You: ...
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
