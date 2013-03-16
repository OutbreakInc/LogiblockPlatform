#ifndef __GALAGO_H__
#define __GALAGO_H__

#include <stddef.h>

typedef unsigned char	byte;

namespace Galago {

class Buffer
{
public:
	inline					Buffer(void) {};
	inline					Buffer(Buffer const& b);
	inline Buffer&			operator =(Buffer const& b);
	
	inline size_t				length() const;
	inline byte*			bytes();
	inline byte const*		bytes() const;
	
	static inline Buffer	New(char const* cStr);
	static inline Buffer	New(size_t length);
	static inline Buffer	New(void* b, size_t length);
	
	Buffer					operator +(Buffer const& b) const;
	Buffer&					operator +=(Buffer const& b);
	
	bool					operator ==(Buffer const& b) const;
	bool					operator ==(char const* cStr) const;
	
	unsigned int			ParseUint(int base = 10);
	signed int				ParseInt(int base = 10);
	
	bool					StartsWith(byte const* str, size_t length) const;
	bool					StartsWith(char const* cStr) const;
	bool					Equals(byte const* str, size_t length) const;
	
	byte					operator[](size_t offset) const;
	
	Buffer					Slice(size_t start, size_t end);
	size_t					IndexOf(byte b, size_t offset = 0);
	size_t					IndexOf(Buffer b, size_t offset = 0);
};

class IO
{
public:

	class Pin
	{
		friend class IO;

	public:
		typedef enum
		{
			DigitalInput,
			DigitalOutput,
			AnalogInput,
			
			Reset,
			SPI,
			I2C,
			UART,
			PWM,
			USB,

			ClockOutput,
			Wakeup,

			Manual = 0xFE,
			Default = 0xFF,
		} Mode;

		typedef enum
		{
			Normal,
			PullUp,
			PullDown,
			
			Sensitive,

			OpenDrain,
		} Feature;
		
		inline			Pin(void)				{}
		inline			Pin(Pin const& p)		{}
		inline	Pin&	operator =(Pin const& p)	{}

		inline	Pin&	operator =(bool value)	{}
		inline	Pin&	operator =(int value)	{}
		inline			operator bool(void)		{return((bool)read());}

		int				read(void);
		void			write(int value);

		inline	void	setOutput(void)		{setMode(DigitalOutput);}
		inline	void	setInput(void)		{setMode(DigitalInput);}
		inline	void	setAnalog(void)		{setMode(AnalogInput);}
		inline	void	setPWM(void)		{setMode(PWM);}
		
		void			setMode(Mode mode, Feature feature = Normal);

	private:
		inline			Pin(unsigned int value): v(value)	{setMode(Default);}
		
		unsigned int	v;
	};

	class SPI
	{
	public:
		typedef enum
		{
			Master,
			Slave,
		} Role;
		
		typedef enum
		{
			Mode0,	//SCK idles low, data changed on SCK's falling edge, read on rising edge.
			Mode1,	//SCK idles low, data changed on SCK's rising edge, read on falling edge.
			Mode2,	//SCK idles high, data changed on SCK's falling edge, read on rising edge.
			Mode3,	//SCK idles high, data changed on SCK's rising edge, read on falling edge.
		} Mode;

		void			start(int bitRate = 2000000UL, Role role = Master, Mode mode = Mode0);
		inline void		stop(void)	{start(0);}

		bool			bytesAvailable(void) const;

		void			read(int length, byte* bytesReadBack, unsigned short writeChar = 0);
		void			read(int length, unsigned short* bytesReadBack, unsigned short writeChar = 0);
		
		inline void		readAndWrite(char const* s, int length, byte* bytesReadBack) {write((byte const*)s, length, bytesReadBack);}
		inline void		readAndWrite(byte const* s, int length, byte* bytesReadBack) {write(s, length, bytesReadBack);}
		inline void		readAndWrite(unsigned short const* s, int length, byte* bytesReadBack) {write(s, length, bytesReadBack);}
		
		inline void		write(char c, int length = 1)		{write((unsigned short)c, length);}
		inline void		write(byte b, int length = 1)		{write((unsigned short)b, length);}
		inline void		write(short h, int length = 1)		{write((unsigned short)h, length);}
		void			write(unsigned short h, int length = 1);

		inline void		write(char const* s, int length, byte* bytesReadBack = 0)	{write((byte const*)s, length, bytesReadBack);}
		void			write(byte const* s, int length, byte* bytesReadBack = 0);
		void			write(unsigned short const* s, int length, byte* bytesReadBack = 0);
	};

	class I2C
	{
	};

	class UART
	{
	public:
		enum
		{
			CharsAre5Bit			=	(0x00),
			CharsAre6Bit			=	(0x01),
			CharsAre7Bit			=	(0x02),
			CharsAre8Bit			=	(0x03),
			
			NoStopBit				=	(0x00),
			UseStopBit				=	(0x04),
			
			NoParity				=	(0x08),
			UseOddParity			=	(0x08 | (0x00 << 4)),
			UseEvenParity			=	(0x08 | (0x01 << 4)),
			UseConstant1Parity		=	(0x08 | (0x02 << 4)),
			UseConstant0Parity		=	(0x08 | (0x03 << 4)),
		};
		typedef int		Mode;
		
		typedef enum
		{
			Event_BytesReceived,
			Event_ErrorReceived,
		} Event;
		
		void			start(int baudRate = 9600, Mode mode = (CharsAre8Bit | NoParity | UseStopBit));
		void			startWithExplicitRatio(int divider, int fracN, int fracD, Mode mode);
		inline void		stop(void)	{start(0);}
		
		typedef void	(*UARTCallback)(void* receiver, UART& uart, Event event, Buffer bytes);
		void			on(UARTCallback callback, void* receiver = 0);

		bool			bytesAvailable(void) const;

		inline int		read(char* s, int length, bool readAll = false)	{read((byte*)s, length, readAll);}
		int				read(byte* s, int length, bool readAll = false);

		inline int		write(char c, bool writeAll = true)		{return(write((byte)c, writeAll));}
		inline int		write(short h, bool writeAll = true)	{return(write((byte)h, writeAll));}
		int				write(byte b, bool writeAll = true);

		inline int		write(char const* s, int length = -1, bool writeAll = true)	{return(write((byte const*)s, length, writeAll));}
		int				write(byte const* s, int length = -1, bool writeAll = true);
	};

	Pin				P0;
	Pin				P1;
	Pin				P2;
	Pin				P3;
	Pin				P4;
	Pin				P5;
	Pin				P6;
	Pin				RTS;
	Pin				CTS;
	Pin				TXD;
	Pin				RXD;
	Pin				SDA;
	Pin				SCL;
	Pin				SCK;
	Pin				SEL;
	Pin				MISO;
	Pin				MOSI;
	Pin				A0;
	Pin				A1;
	Pin				A2;
	Pin				A3;
	Pin				A5;
	Pin				A7;
	
	Pin				led;
	
	SPI				spi;
	
	I2C				i2c;
	
	UART			serial;

					IO(void);
private:
	unsigned int	v;
};

class System
{
public:
	unsigned int	getCoreFrequency(void) const;
	unsigned int	setCoreFrequency(unsigned int kHz);
	
	void			sleep(void) const;
	void			delay(int microseconds) const;
	int				addTimedTask(int period, bool repeat, void (*task)(void*), void* ref = 0);
	bool			removeTimedTask(int id);
	bool			removeTimedTask(void (*task)(void*), void* ref = 0);
					
					System(void);
};

static IO		IO;
static System	System;

}	//ns Galago

#endif //defined __GALAGO_H__